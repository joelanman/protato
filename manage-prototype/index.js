// manage prototype - public interface

import { getManagePrototypeApp } from './app.js'
import { getManagePrototypeDevApp } from './dev-app.js'
import managePrototypeNunjucks from './nunjucks.js'

export default {
	nunjucks: managePrototypeNunjucks,
	getApp: getManagePrototypeApp,
	getDevApp: getManagePrototypeDevApp
}
