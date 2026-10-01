-- An action can be aimed at one membership interest. Several actions can
-- belong to the same referring campaign without sharing a primary key.
ALTER TABLE onboarding_actions ADD COLUMN referral_source TEXT;
ALTER TABLE onboarding_actions ADD COLUMN interest TEXT;

UPDATE onboarding_actions SET referral_source = id WHERE referral_source IS NULL;
