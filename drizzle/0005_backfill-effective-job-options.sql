UPDATE `generation_jobs`
SET `effective_options_json` = (
  SELECT `options_json`
  FROM `generation_runs`
  WHERE `generation_runs`.`id` = `generation_jobs`.`run_id`
);
