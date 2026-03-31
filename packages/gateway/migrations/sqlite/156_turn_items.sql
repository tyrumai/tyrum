CREATE TABLE turn_items (
  tenant_id      TEXT NOT NULL,
  turn_item_id   TEXT NOT NULL,
  turn_id        TEXT NOT NULL,
  item_index     INTEGER NOT NULL CHECK (item_index >= 0),
  item_key       TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('message')),
  payload_json   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, turn_item_id),
  UNIQUE (tenant_id, turn_id, item_index),
  UNIQUE (tenant_id, turn_id, item_key),
  FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE CASCADE
);

CREATE INDEX turn_items_turn_order_idx
  ON turn_items (tenant_id, turn_id, created_at ASC, item_index ASC);
