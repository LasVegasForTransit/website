-- Find linked resources by the current Discord location without scanning unrelated work.
CREATE INDEX discord_work_home_destination ON discord_project_homes(scope_key,destination_id,state,id);
CREATE INDEX discord_work_conversation_thread ON discord_work_conversations(scope_key,thread_id,state,id);
