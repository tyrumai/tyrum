UPDATE catalog_provider_overrides
SET npm = CASE npm
  WHEN '@gitlab/gitlab-ai-provider' THEN 'gitlab-ai-provider'
  WHEN 'venice-ai-sdk-provider' THEN '@ai-sdk/openai-compatible'
  ELSE npm
END
WHERE npm IN ('@gitlab/gitlab-ai-provider', 'venice-ai-sdk-provider');

UPDATE catalog_model_overrides
SET provider_npm = CASE provider_npm
  WHEN '@gitlab/gitlab-ai-provider' THEN 'gitlab-ai-provider'
  WHEN 'venice-ai-sdk-provider' THEN '@ai-sdk/openai-compatible'
  ELSE provider_npm
END
WHERE provider_npm IN ('@gitlab/gitlab-ai-provider', 'venice-ai-sdk-provider');

DELETE FROM models_dev_cache;
