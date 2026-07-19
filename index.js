const express = require('express');
const app = require('./frontend/js/server');

if (!app || typeof app !== 'function') {
  throw new Error('Express app export missing from frontend/js/server.js');
}

module.exports = app;
module.exports.default = app;
exports.default = app;
