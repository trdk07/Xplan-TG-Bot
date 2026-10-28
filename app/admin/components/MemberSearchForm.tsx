import { Search } from "lucide-react";
import { v2Enabled, v2Statuses } from "@/lib/membership-v2";
import { memberStatusLabel, memberStatuses } from "@/lib/status";

type Props = {
  q: string;
  status: string;
};

export function MemberSearchForm({ q, status }: Props) {
  return (
    <form className="toolbar">
      <div className="field">
        <label htmlFor="q">搜尋</label>
        <input
          className="input"
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Telegram ID、使用者名稱、Email、UID…"
        />
      </div>
      <div className="field">
        <label htmlFor="status">狀態</label>
        <select className="input" id="status" name="status" defaultValue={status}>
          <option value="all">全部</option>
          {(v2Enabled() ? v2Statuses : memberStatuses.filter(item => !["free","active_volume","suspended"].includes(item))).map((item) => (
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
