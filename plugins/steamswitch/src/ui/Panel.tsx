import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import { getStatus, type SwitchStatus } from "../api";
import { report } from "../report";

/** Quick Access Menu panel: which accounts are saved here, and how the last switch went. */
export function Panel() {
  const [status, setStatus] = useState<SwitchStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setBusy(true);
    getStatus()
      .then((next) => setStatus(next))
      .catch((exc: unknown) => {
        report(`status: ${String(exc)}`);
        setStatus({ ok: false, supported: false, accounts: [], error: String(exc) });
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!status) {
    return (
      <PanelSection title="Steam Switch">
        <PanelSectionRow>
          <Field label="Reading the local Steam install..." />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (!status.ok) {
    return (
      <PanelSection title="Steam Switch">
        <PanelSectionRow>
          <Field label="Not available" description={status.error || "unknown error"} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const accounts = status.accounts || [];
  const current = status.current;
  const last = status.last || {};
  const other = accounts.filter((account) => account.id64 !== (current ? current.id64 : ""));

  return (
    <div>
      <PanelSection title="Steam Switch">
        <PanelSectionRow>
          <Field
            label={current ? current.persona : "signed out"}
            description={current ? `signed in (${current.account})` : "no account detected"}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label={other.length ? `${other.length} other account(s) remembered` : "no other account"}
            description={
              other.length
                ? other.map((account) => account.persona || account.account).join(", ")
                : "the other account has to sign in once on this PC"
            }
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Last switch">
        <PanelSectionRow>
          <Field
            label={last.state ? String(last.state) : "nothing yet"}
            description={last.message ? String(last.message) : "start one from a game's page"}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy} onClick={refresh}>
            {busy ? "refreshing..." : "refresh"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="How it works">
        <PanelSectionRow>
          <Field
            label="Switch account & Play"
            description="On a game owned by another saved account, the Borrow button signs Steam into that account and starts the game there."
          />
        </PanelSectionRow>
      </PanelSection>
    </div>
  );
}
