ALTER TABLE desktop_environment_hosts
  ADD COLUMN docker_available_v2 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE desktop_environment_hosts
  ADD COLUMN healthy_v2 BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE desktop_environment_hosts
   SET docker_available_v2 = (docker_available <> 0),
       healthy_v2 = (healthy <> 0);

ALTER TABLE desktop_environment_hosts
  DROP COLUMN docker_available;

ALTER TABLE desktop_environment_hosts
  DROP COLUMN healthy;

ALTER TABLE desktop_environment_hosts
  RENAME COLUMN docker_available_v2 TO docker_available;

ALTER TABLE desktop_environment_hosts
  RENAME COLUMN healthy_v2 TO healthy;

ALTER TABLE desktop_environments
  ADD COLUMN desired_running_v2 BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE desktop_environments
   SET desired_running_v2 = (desired_running <> 0);

ALTER TABLE desktop_environments
  DROP COLUMN desired_running;

ALTER TABLE desktop_environments
  RENAME COLUMN desired_running_v2 TO desired_running;
