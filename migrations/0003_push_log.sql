-- Журнал отправленных напоминаний: что пришло семье в этот день (items — [{ pet, text }]).
-- Одна строка на журнал и день: у нескольких устройств семьи уведомление одно и то же. Хранится 90 дней.
CREATE TABLE push_log (
  journal_id TEXT NOT NULL,
  day TEXT NOT NULL,
  items TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (journal_id, day)
);
