-- Persist normalized ingress threads and messages for Telegram conversation replay.
CREATE TABLE IF NOT EXISTS ingress_threads (
    source TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT,
    username TEXT,
    pii_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ingress_threads_pk PRIMARY KEY (source, thread_id),
    CHECK (char_length(trim(source)) > 0),
    CHECK (char_length(trim(thread_id)) > 0),
    CHECK (kind IN ('private', 'group', 'supergroup', 'channel', 'other')),
    CHECK (
        pii_fields <@ ARRAY[
            'message_caption',
            'message_text',
            'sender_first_name',
            'sender_last_name',
            'sender_language_code',
            'sender_username',
            'thread_title',
            'thread_username'
        ]::TEXT[]
    )
);

COMMENT ON TABLE ingress_threads IS 'Normalized external chat threads grouped by ingress source.';
COMMENT ON COLUMN ingress_threads.source IS 'Ingress surface for the thread (e.g. telegram).';
COMMENT ON COLUMN ingress_threads.thread_id IS 'Identifier of the thread within the ingress source.';
COMMENT ON COLUMN ingress_threads.kind IS 'Thread classification reported by the ingress surface.';
COMMENT ON COLUMN ingress_threads.title IS 'Optional title provided by the ingress surface.';
COMMENT ON COLUMN ingress_threads.username IS 'Username handle associated with the thread when available.';
COMMENT ON COLUMN ingress_threads.pii_fields IS 'Set of thread fields containing PII requiring redaction downstream.';
COMMENT ON COLUMN ingress_threads.created_at IS 'Timestamp when the thread record was created.';
COMMENT ON COLUMN ingress_threads.updated_at IS 'Timestamp when the thread record was last updated.';

CREATE INDEX IF NOT EXISTS ingress_threads_source_kind_idx
    ON ingress_threads (source, kind);

CREATE TABLE IF NOT EXISTS ingress_messages (
    source TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    content JSONB NOT NULL,
    sender JSONB,
    occurred_at TIMESTAMPTZ NOT NULL,
    edited_at TIMESTAMPTZ,
    pii_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ingress_messages_pk PRIMARY KEY (source, thread_id, message_id),
    CONSTRAINT ingress_messages_thread_fk FOREIGN KEY (source, thread_id)
        REFERENCES ingress_threads (source, thread_id)
        ON DELETE CASCADE,
    CHECK (char_length(trim(source)) > 0),
    CHECK (char_length(trim(thread_id)) > 0),
    CHECK (char_length(trim(message_id)) > 0),
    CHECK (jsonb_typeof(content) = 'object'),
    CHECK (
        sender IS NULL
        OR jsonb_typeof(sender) = 'object'
    ),
    CHECK (
        pii_fields <@ ARRAY[
            'message_caption',
            'message_text',
            'sender_first_name',
            'sender_last_name',
            'sender_language_code',
            'sender_username',
            'thread_title',
            'thread_username'
        ]::TEXT[]
    )
);

COMMENT ON TABLE ingress_messages IS 'Normalized ingress messages captured for planner replay and auditing.';
COMMENT ON COLUMN ingress_messages.source IS 'Ingress surface that emitted the message (e.g. telegram).';
COMMENT ON COLUMN ingress_messages.thread_id IS 'Thread identifier tying the message to its conversation.';
COMMENT ON COLUMN ingress_messages.message_id IS 'Identifier of the message within its ingress thread.';
COMMENT ON COLUMN ingress_messages.content IS 'Normalized message content stored as JSON.';
COMMENT ON COLUMN ingress_messages.sender IS 'Sender metadata captured for the message when supplied.';
COMMENT ON COLUMN ingress_messages.occurred_at IS 'Timestamp when the message was created by the ingress surface.';
COMMENT ON COLUMN ingress_messages.edited_at IS 'Timestamp of the last edit reported by the ingress surface, if any.';
COMMENT ON COLUMN ingress_messages.pii_fields IS 'Set of message or thread fields containing PII requiring redaction downstream.';
COMMENT ON COLUMN ingress_messages.created_at IS 'Timestamp when the message record was created.';

CREATE INDEX IF NOT EXISTS ingress_messages_thread_time_idx
    ON ingress_messages (source, thread_id, occurred_at);
