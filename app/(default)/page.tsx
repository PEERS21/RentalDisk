export const metadata = {
  title: "Home - Open PRO",
  description: "Page description",
};

import PageIllustration from "@/components/page-illustration";
import Workflows from "@/components/workflows";

export default function Home() {
  return (
    <>
      <PageIllustration />
      <Workflows />
    </>
  );
}
