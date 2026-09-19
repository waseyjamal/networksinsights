import { useEffect, useState } from "react";

export default function IslandCheck() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return <p>{hydrated ? "Interactive: yes" : "Interactive: no"}</p>;
}
