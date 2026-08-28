-- Bodegas Don Luis: reduce Peru liquor census cadence from every 6 hours to weekly.
-- Cron runs in UTC. Jobs are staggered on Tuesdays from 11:05 to 11:43 UTC
-- (06:05 to 06:43 in Peru) to avoid overloading the public retail sources.

with schedules(jobname, schedule) as (
  values
    ('bdl-census-metro-pisco',      '5 11 * * 2'),
    ('bdl-census-metro-ron',        '7 11 * * 2'),
    ('bdl-census-metro-vino',       '9 11 * * 2'),
    ('bdl-census-tottus-pisco',     '11 11 * * 2'),
    ('bdl-census-tottus-ron',       '13 11 * * 2'),
    ('bdl-census-tottus-vino',      '15 11 * * 2'),
    ('bdl-census-vivanda-pisco',    '17 11 * * 2'),
    ('bdl-census-vivanda-ron',      '19 11 * * 2'),
    ('bdl-census-vivanda-vino',     '21 11 * * 2'),
    ('bdl-census-plazavea-pisco',   '23 11 * * 2'),
    ('bdl-census-plazavea-ron',     '25 11 * * 2'),
    ('bdl-census-plazavea-vino',    '27 11 * * 2'),
    ('bdl-census-wong-pisco',       '29 11 * * 2'),
    ('bdl-census-wong-ron',         '31 11 * * 2'),
    ('bdl-census-wong-vino-01',     '33 11 * * 2'),
    ('bdl-census-wong-vino-02',     '35 11 * * 2'),
    ('bdl-census-wong-vino-03',     '37 11 * * 2'),
    ('bdl-census-wong-vino-04',     '39 11 * * 2'),
    ('bdl-census-wong-vino-05',     '41 11 * * 2'),
    ('bdl-census-wong-vino-06',     '43 11 * * 2')
)
select cron.alter_job(j.jobid, schedule := s.schedule)
from schedules s
join cron.job j on j.jobname = s.jobname;
