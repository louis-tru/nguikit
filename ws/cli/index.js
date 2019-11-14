/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2015, xuewen.chu
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of xuewen.chu nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL xuewen.chu BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 * ***** END LICENSE BLOCK ***** */

var util = require('../../util');
var errno = require('../../errno');
var { Notification } = require('../../event');
var { T_CALLBACK,T_CALL} = require('../data');
var conv = require('./conv');

var METHOD_CALL_TIMEOUT = 12e4; // 120s

/** 
 * @func callFunction()
*/
async function callFunction(self, msg) {
	var { data = {}, name, cb } = msg;
	// if (util.dev) {
	// 	console.log('WSClient.Call', `${self.name}.${name}(${JSON.stringify(data, null, 2)})`);
	// }
	var err, r;
	try {
		r = await self.handleCall(name, data);
	} catch(e) { err = e }

	if (!cb) { // No callback
		if (err)
			console.warn(err);
		return;
	}
	var rev = {
		service: self.conv._service(self.name), type: T_CALLBACK, cb
	};
	if (err) {
		rev.error = err; // Error.toJSON(err);
	} else {
		rev.data = r;
	}
	self.conv.sendFormattedData(rev);
}

/**
 * @class WSClient
 */
class WSClient extends Notification {
	// @private:
	// m_callbacks: null,
	// m_service_name: '',
	// m_conv: null,   // conversation

	// @public:
	get name() { return this.m_service_name }
	get conv() { return this.m_conv }

	/**
	 * @constructor constructor(service_name, conv)
	 */
	constructor(service_name, conv) {
		super();
		this.m_callbacks = {};
		this.m_service_name = service_name;
		this.m_conv = conv || new WSConversation();
		util.assert(service_name);
		util.assert(this.m_conv);

		this.m_conv.onOpen.on(e=>{
			this.m_Intervalid = setInterval(e=>this._checkTimeout(), 3e4); // 30s
		});
		this.m_conv.onClose.on(async e=>{
			var callbacks = this.m_callbacks;
			this.m_callbacks = {};
			var err = Error.new(errno.ERR_CONNECTION_DISCONNECTION);
			for (var handle of Object.values(callbacks)) {
				// handle.send.cancel = true;
				handle.err(err);
			}
			clearInterval(this.m_Intervalid);
		});
		this.m_conv.bind(this);
	}

	/**
	 * @func receiveMessage(msg)
	 */
	receiveMessage(msg) {
		if (msg.isCall()) {
			callFunction(this, msg);
		} else if (msg.isCallback()) {
			var cb = this.m_callbacks[msg.cb];
			delete this.m_callbacks[msg.cb];
			if (cb) {
				if (msg.error) { // throw error
					cb.err(Error.new(msg.error));
				} else {
					cb.ok(msg.data);
				}
			} else {
				console.warn('Unable to callback, no callback context can be found');
			}
		} else if (msg.isEvent()) {
			this.trigger(msg.name, msg.data);
		}
	}

	/**
	 * @class handleCall
	 */
	handleCall(method, data) {
		if (method in WSClient.prototype) {
			throw Error.new(errno.ERR_FORBIDDEN_ACCESS);
		}
		var fn = this[method];
		if (typeof fn != 'function') {
			throw Error.new('"{0}" no defined function'.format(name));
		}
		return fn.call(this, data);
	}

	_checkTimeout() {
		var now = Date.now();
		var callbacks = this.m_callbacks;
		for (var cb in callbacks) {
			var handle = callbacks[cb];
			if (handle.timeout) {
				if (handle.timeout < now) { // timeouted
					handle.err(Error.new([...errno.ERR_METHOD_CALL_TIMEOUT,
						`Method call timeout, ${this.name}/${handle.method}`]));
					handle.send.cancel = true;
					delete callbacks[cb];
				}
			}
		}
	}

	/**
	 * @func call(method, data, timeout)
	 */
	call(method, data, timeout = exports.METHOD_CALL_TIMEOUT) {
		return util.promise(async (resolve, reject)=>{
			var cb = util.id;
			this.m_callbacks[cb] = {
				timeout: timeout ? timeout + Date.now(): 0,
				method: method,
				ok: resolve,
				err: reject,
				send: await this.m_conv.sendFormattedData({
					service: this.conv._service(this.name),
					type: T_CALL,
					name: method,
					data: data,
					cb: cb,
				}),
			};
		});
	}

	/**
	 * @func weakCall(method, data) no callback, no return data
	 */
	weakCall(method, data) {
		this.m_conv.sendFormattedData({
			service: this.conv._service(this.name),
			type: T_CALL,
			name: method,
			data: data,
		});
	}

}

module.exports = exports = Object.assign({
	METHOD_CALL_TIMEOUT,
	WSClient,
}, conv);