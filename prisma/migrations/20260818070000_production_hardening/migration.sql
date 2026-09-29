-- Production hardening: make external payment identifiers idempotent per provider.
CREATE UNIQUE INDEX "Payment_provider_providerPaymentId_key" ON "Payment"("provider", "providerPaymentId");
