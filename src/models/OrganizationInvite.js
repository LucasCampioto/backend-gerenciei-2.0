const mongoose = require('mongoose');
const { ORG_ROLES } = require('../constants/orgPermissions');

const organizationInviteSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ORG_ROLES.filter((r) => r !== 'owner'),
      default: 'member',
    },
    permissions: {
      type: [String],
      default: [],
    },
    /** Comissão padrão do colaborador (aplicada ao Employee no aceite). */
    generalCommission: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    procedureCommissions: [
      {
        procedureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Procedure' },
        percentage: { type: Number, min: 0, max: 100 },
        _id: false,
      },
    ],
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },
    invitedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    acceptedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

organizationInviteSchema.index({ organizationId: 1, email: 1, status: 1 });
organizationInviteSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('OrganizationInvite', organizationInviteSchema);
