// Função para converter ObjectId para string (id)
function toId(obj) {
  if (obj && obj._id) {
    const newObj = { ...obj.toObject ? obj.toObject() : obj };
    newObj.id = newObj._id.toString();
    delete newObj._id;
    return newObj;
  }
  return obj;
}

// Função para converter array de documentos
function toIdArray(array) {
  return array.map(toId);
}

module.exports = {
  toId,
  toIdArray
};

