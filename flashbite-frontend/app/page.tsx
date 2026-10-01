import { redirect } from "next/navigation";

/** Root route — immediately redirect to the login page. */
export default function Home() {
  redirect("/login");
}
