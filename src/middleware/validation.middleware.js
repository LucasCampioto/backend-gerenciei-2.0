function validate(schema) {
  return async (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });
      
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Erro de validação',
          details: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          }))
        });
      }
      
      req.body = value;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate };

