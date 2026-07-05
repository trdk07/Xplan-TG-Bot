import { Search } from "lucide-react";
import { memberStatusLabel, memberStatuses } from "@/lib/status";

type Props = {
  q: string;
  status: string;
};

export function MemberSearchForm({ q, status }: Props) {
  return (
    <form className="toolbar">
      <div className="field">
        <label htmlFor="q">Search</label>
        <input
          className="input"
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Telegram ID, username, email, UID..."
        />
      </div>
      <div className="field">
        <label htmlFor="status">Status</label>
        <select className="input" id="status" name="status" defaultValue={status}>
          <option value="all">all</option>
          {memberStatuses.map((item) => (
            <option key={item} value={item}>
              {memberStatusLabel(item)}
            </option>
          ))}
        </select>
      </div>
      <button className="button" type="submit">
        <Search width={16} height={16} aria-hidden="true" />
        搜尋
      </button>
    </form>
  );
}
