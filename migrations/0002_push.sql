-- Напоминания (Web Push).

-- Подписка устройства: адрес службы уведомлений (Apple, Google…) и ключи шифрования.
-- hour и tz — в котором часу и по какому часовому поясу присылать; last_day — день последней рассылки.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  hour INTEGER NOT NULL DEFAULT 10,
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  last_day TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX push_subs_device ON push_subs (device_id);
CREATE INDEX push_subs_journal ON push_subs (journal_id);

-- План напоминаний журнала: [{ day: 'ГГГГ-ММ-ДД', pet: 'Рекс', text: 'Сегодня: обработка' }].
-- Его считает приложение (там вся логика сроков) и присылает после каждой синхронизации.
CREATE TABLE push_plans (
  journal_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
