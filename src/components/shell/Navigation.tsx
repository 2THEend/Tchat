import { Home, Compass, User } from 'lucide-react';
import { NavigationPlace } from '../../types/navigation';

interface NavigationProps {
  currentPlace: NavigationPlace;
  onSelectPlace: (place: NavigationPlace) => void;
}

interface Destination {
  id: NavigationPlace;
  label: string;
  icon: typeof Home;
}

const DESTINATIONS: Destination[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'feed', label: 'Feed', icon: Compass },
  { id: 'profile', label: 'Profile', icon: User },
];

export function Navigation({ currentPlace, onSelectPlace }: NavigationProps) {
  return (
    <nav
      id="permanent-navigation"
      aria-label="Places navigation"
      className="w-full bg-stone-950/90 backdrop-blur-md border-t border-stone-800/60 px-6 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]"
    >
      <div className="flex items-center justify-around max-w-xs mx-auto">
        {DESTINATIONS.map((dest) => {
          const Icon = dest.icon;
          const isActive = currentPlace === dest.id;

          return (
            <button
              key={dest.id}
              id={`nav-tab-${dest.id}`}
              type="button"
              onClick={() => onSelectPlace(dest.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center py-1 px-4 rounded-xl transition-all duration-200 cursor-pointer min-w-[56px] ${
                isActive
                  ? 'text-stone-100 font-medium'
                  : 'text-stone-500 hover:text-stone-300'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-105 stroke-[2.2]' : 'stroke-[1.7]'}`} />
                {isActive && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-stone-100" />
                )}
              </div>
              <span className="text-[11px] mt-1.5 tracking-tight font-medium">
                {dest.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
