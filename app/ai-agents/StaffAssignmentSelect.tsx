"use client";

import { useEffect, useState } from "react";

type StaffOption = {
  userId: string;
  role: string;
  displayName: string;
};

type StaffAssignmentSelectProps = {
  hospitalId: string;
  value: string;
  onChange: (userId: string) => void;
};

function roleLabel(role: string) {
  return role.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export default function StaffAssignmentSelect({
  hospitalId,
  value,
  onChange,
}: StaffAssignmentSelectProps) {
  const [members, setMembers] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMembers() {
      try {
        const response = await fetch(
          "/api/operations/follow-ups?hospitalId=" + encodeURIComponent(hospitalId),
          { cache: "no-store", signal: controller.signal },
        );

        if (!response.ok) throw new Error("Member list unavailable");

        const payload = await response.json() as { members?: StaffOption[] };
        if (!controller.signal.aborted) {
          setMembers(Array.isArray(payload.members) ? payload.members : []);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMembers();
    return () => controller.abort();
  }, [hospitalId]);

  return (
    <label>
      Assign to <span>(optional)</span>
      <select
        value={value}
        disabled={loading || error}
        onChange={event => onChange(event.target.value)}
      >
        <option value="">
          {loading ? "Loading active staff…" : error ? "Assignment list unavailable" : "Leave unassigned"}
        </option>
        {members.map(member => (
          <option key={member.userId} value={member.userId}>
            {member.displayName} · {roleLabel(member.role)}
          </option>
        ))}
      </select>
      {error && <small>Staff could not be loaded. You can still create this task unassigned.</small>}
    </label>
  );
}
