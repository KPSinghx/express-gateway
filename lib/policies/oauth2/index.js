module.exports = {
  policy: require('./oauth2'),
  routes: require('./oauth2-routes'),
  schema: {
    type: 'object',
    properties: {
      passThrough: { type: 'boolean', default: 'false' },
      tokenType: { type: 'string', default: 'opaque', enum: ['opaque', 'jwt'] }
    },
    required: ['passThrough', 'tokenType']
  }
};
