import Topbar from '../components/Topbar'

// Paused on purpose: the cases table is filled one-way from COM / D365 and is
// shared by the dashboard and routing app. Writing new rows into it from here
// would mix app-made cases with COM cases. New requests will come in through
// the customer portal into their own table, then be logged in COM.
export default function NewCase() {
  return (
    <>
      <Topbar title="New Case" sub="Paused" />
      <div className="page-content">
        <div className="notice warn">
          ⏸ Creating cases here is paused. Cases come from COM (D365) and are shared with the dashboard and routing app,
          so this app must not write into that table. New requests will come through the customer portal into a separate table.
        </div>
      </div>
    </>
  )
}
