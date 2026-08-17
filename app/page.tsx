import { redirect } from "next/navigation"

// There is no marketing surface yet (PLAN.md section 2 notes SSR gives us the option
// later). Until then the root is just the way into the app.
export default function Home() {
  redirect("/dashboard")
}
