import sql from "@/services/db.service";
import { cooldownActive } from "@/services/abuse-identity.service";

export async function prepareAbuseIdentity(
  website: string,
  session: string,
  identity: string,
) {
  return sql.begin(async (tx) => {
    const [s] =
      await tx`select * from session where website_id=${website} and session_id=${session} for update`;
    if (!s) throw new Error("Conversation not found");
    const legacy = !s.abuse_identity_key;
    const legacyUntil =
      legacy && s.abuse_ended_at
        ? new Date(new Date(s.abuse_ended_at).getTime() + 3600000)
        : null;
    await tx`insert into abuse_identity (website_id,identity_key,warning_count,blocked_until)
      values (${website},${identity},${legacy ? Number(s.abuse_warning_count) : 0},${legacyUntil})
      on conflict (website_id,identity_key) do nothing`;
    let [state] =
      await tx`select * from abuse_identity where website_id=${website} and identity_key=${identity} for update`;
    if (legacy) {
      [state] =
        await tx`update abuse_identity set warning_count=greatest(warning_count,${Number(s.abuse_warning_count)}),
        blocked_until=greatest(blocked_until,${legacyUntil}) where website_id=${website} and identity_key=${identity} returning *`;
      await tx`update abuse_warning set identity_key=${identity},generation=${state.generation}
        where website_id=${website} and session_id=${session} and identity_key is null`;
    }
    if (state.blocked_until && !cooldownActive(state.blocked_until)) {
      [state] =
        await tx`update abuse_identity set warning_count=0,blocked_until=null,generation=generation+1,updated_at=now()
        where website_id=${website} and identity_key=${identity} returning *`;
      await tx`update abuse_warning set cancelled_at=now() where website_id=${website} and identity_key=${identity} and delivered_at is null and cancelled_at is null`;
    }
    const blocked = cooldownActive(state.blocked_until);
    const [current] =
      await tx`update session set abuse_identity_key=${identity},abuse_identity_generation=${state.generation},
      abuse_warning_count=${Number(state.warning_count)},abuse_blocked_until=${state.blocked_until},
      abuse_ended_at=case when ${blocked} then coalesce(abuse_ended_at,now()) else null end,
      enable_reply=case when ${blocked} then false when abuse_disabled_by_policy then true else enable_reply end,
      abuse_disabled_by_policy=case when ${blocked} then (abuse_disabled_by_policy or enable_reply) else false end
      where website_id=${website} and session_id=${session} returning *`;
    return {
      identity: state.identity_key as string,
      generation: Number(state.generation),
      blocked,
      blockedUntil: state.blocked_until,
      count: Number(state.warning_count),
      session: current,
    };
  });
}
export async function identityBlocked(website: string, identity: string) {
  const [row] =
    await sql`select blocked_until from abuse_identity where website_id=${website} and identity_key=${identity}`;
  return cooldownActive(row?.blocked_until);
}
export async function reserveIdentityWarning(
  website: string,
  session: string,
  key: string,
) {
  return sql.begin(async (tx) => {
    const [s] =
      await tx`select * from session where website_id=${website} and session_id=${session} for update`;
    if (!s?.abuse_identity_key)
      throw new Error("Conversation identity not prepared");
    const [existing] =
      await tx`select * from abuse_warning where website_id=${website} and session_id=${session} and message_key=${key}`;
    if (existing) return existing;
    const [state] =
      await tx`select * from abuse_identity where website_id=${website} and identity_key=${s.abuse_identity_key} for update`;
    if (
      cooldownActive(state.blocked_until) ||
      Number(state.generation) !== Number(s.abuse_identity_generation)
    )
      return null;
    const count = Math.min(3, Number(state.warning_count) + 1);
    const [updated] =
      await tx`update abuse_identity set warning_count=${count},blocked_until=case when ${count}=3 then now()+interval '1 hour' else null end,updated_at=now()
      where website_id=${website} and identity_key=${s.abuse_identity_key} returning *`;
    await tx`update session set abuse_warning_count=${count},abuse_blocked_until=${updated.blocked_until},
      abuse_ended_at=case when ${count}=3 then now() else null end,
      abuse_disabled_by_policy=case when ${count}=3 then enable_reply else abuse_disabled_by_policy end,
      enable_reply=case when ${count}=3 then false else enable_reply end,
      enable_time=case when ${count}=3 then now() else enable_time end where website_id=${website} and session_id=${session}`;
    const [warning] =
      await tx`insert into abuse_warning (website_id,session_id,message_key,warning_number,identity_key,generation)
      values (${website},${session},${key},${count},${s.abuse_identity_key},${state.generation}) returning *`;
    return warning;
  });
}
export async function mayDeliverWarning(
  website: string,
  session: string,
  key: string,
) {
  const [row] =
    await sql`select w.warning_number,w.created_at,i.blocked_until from abuse_warning w join abuse_identity i
    on i.website_id=w.website_id and i.identity_key=w.identity_key and i.generation=w.generation
    join session s on s.website_id=w.website_id and s.session_id=w.session_id and s.abuse_identity_key=w.identity_key
    where w.website_id=${website} and w.session_id=${session} and w.message_key=${key} and w.delivered_at is null and w.cancelled_at is null`;
  if (!row) return false;
  return (
    !cooldownActive(row.blocked_until) ||
    (row.warning_number === 3 &&
      Date.now() - new Date(row.created_at).getTime() < 30_000)
  );
}
