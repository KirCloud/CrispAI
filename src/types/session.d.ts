interface Session {
  website_id: string;
  session_id: string;
  group_id?: number;
  topic_id?: number;
  message_id?: number;
  enable_reply: boolean;
  enable_time: Date;
  thread: any[];
  abuse_warning_count?: number;
  abuse_ended_at?: Date | string | null;
}
