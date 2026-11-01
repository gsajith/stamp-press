import type { RapierRigidBody } from "@react-three/rapier";
import type { RefObject } from "react";

// Where each stamp on the desk is, for what follows it there: its focus ring, and the detail view lifting it
// from where it lies. Each stamp body adds itself by id, with its size in stamp units. Plain and mutable, as
// it's read every frame.
export type Placed = Map<
  number,
  { body: RefObject<RapierRigidBody | null>; width: number; height: number }
>;
