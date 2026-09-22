import { promisify as nodePromisify } from 'util';

export default (object, method, ...args) =>
    nodePromisify(object[method].bind(object))(...args);