-- Семейные журналы Хвостика. Входа нет: доступ к журналу даёт секретный ключ устройства.

-- Журнал: один на семью. rev растёт с каждым изменением и служит курсором синхронизации.
CREATE TABLE journals (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  recovery_hash TEXT NOT NULL UNIQUE
);

-- Подключённые устройства. Храним только хэш ключа, сам ключ знает лишь устройство.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX devices_journal ON devices (journal_id);

-- Одноразовые приглашения на 7 дней.
CREATE TABLE invites (
  code_hash TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  created_by TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX invites_journal ON invites (journal_id);

-- Питомцы, записи и взвешивания. data — JSON записи; deleted — метка удаления;
-- ts — время изменения на устройстве (побеждает более позднее); rev — номер изменения в журнале.
CREATE TABLE items (
  journal_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  ts INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (journal_id, kind, id)
);
CREATE INDEX items_rev ON items (journal_id, rev);

-- Попытки создать журнал и ввести код: защита от перебора.
CREATE TABLE attempts (
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX attempts_ip ON attempts (ip, kind, ts);
