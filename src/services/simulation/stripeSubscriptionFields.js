/** Campos de assinatura Stripe normalizados para persistência no User. */
function stripeSubscriptionFields(sub) {
  return {
    subscriptionStatus: sub.status,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
  };
}

module.exports = { stripeSubscriptionFields };
