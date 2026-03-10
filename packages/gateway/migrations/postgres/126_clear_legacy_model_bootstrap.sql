-- Remove legacy bootstrap model presets/assignments so upgraded installs also land in the blank
-- control-plane state expected on first launch.

DELETE FROM execution_profile_model_assignments
WHERE preset_key IN (
  'legacy-openai-gpt-4-1-medium',
  'legacy-openai-gpt-4-1-mini-low',
  'legacy-openai-gpt-4-1-mini-medium',
  'legacy-openai-gpt-4-1-mini-high',
  'legacy-openai-gpt-4-1-high'
);

DELETE FROM session_model_overrides
WHERE preset_key IN (
  'legacy-openai-gpt-4-1-medium',
  'legacy-openai-gpt-4-1-mini-low',
  'legacy-openai-gpt-4-1-mini-medium',
  'legacy-openai-gpt-4-1-mini-high',
  'legacy-openai-gpt-4-1-high'
);

DELETE FROM configured_model_presets
WHERE preset_key IN (
  'legacy-openai-gpt-4-1-medium',
  'legacy-openai-gpt-4-1-mini-low',
  'legacy-openai-gpt-4-1-mini-medium',
  'legacy-openai-gpt-4-1-mini-high',
  'legacy-openai-gpt-4-1-high'
);
