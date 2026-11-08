import {ContentLoading} from "@/components/app/ui";

/** Skeletons while a page's code arrives: "still arriving", never a blank that reads as "nothing here". */
export default function OwnTeamLoading() {
  return <ContentLoading label="Loading this page" rows={4} />;
}
