/**
 * Navigation destination types for Tchat.
 * Principle: "Permanent navigation is for places. Contextual navigation is for things happening."
 */

export type NavigationPlace = 'home' | 'feed' | 'profile';

export interface NavigationItem {
  id: NavigationPlace;
  label: string;
}
