'use strict';
// PlayFab-shaped errors. Every error a call can return has a name and a number
// in Microsoft's description; games often check the number, so we keep both.

const { errorCode } = require('./spec');

const STATUS_TEXT = {
  200: 'OK',
  400: 'BadRequest',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'NotFound',
  409: 'Conflict',
  413: 'RequestEntityTooLarge',
  429: 'TooManyRequests',
  500: 'InternalServerError',
  501: 'NotImplemented',
  503: 'ServiceUnavailable',
};

class ApiError extends Error {
  constructor(name, message, httpStatus = 400, details = null) {
    super(message || name);
    this.name = name;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  toJSON() {
    const body = {
      code: this.httpStatus,
      status: STATUS_TEXT[this.httpStatus] || 'BadRequest',
      error: this.name,
      errorCode: errorCode(this.name),
      errorMessage: this.message,
    };
    if (this.details) body.errorDetails = this.details;
    return body;
  }
}

const fail = (name, message, httpStatus, details) => new ApiError(name, message, httpStatus, details);

module.exports = { ApiError, fail, STATUS_TEXT };
