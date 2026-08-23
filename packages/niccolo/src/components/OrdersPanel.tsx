import CityPreviewPanel from './CityPreviewPanel';
import MarketPanel from './MarketPanel';
import { Label, Panel, bodySmall } from './ui';
import { UI } from '../theme';
import type { PlannedRoute } from '../sim/content';
import { findCity } from '../sim/content';
import type { City, GameState, GradeId, Vessel } from '../sim/types';

interface OrdersPanelProps {
  state: GameState;
  selectedVessel: Vessel | null;
  previewCity: City | undefined;
  dockedCityIds: Set<string>;
  insureNext: boolean;
  onInsureChange: (value: boolean) => void;
  onConfirmDispatch: () => void;
  onQueueRoute: (plan: PlannedRoute) => void;
  onBuy: (vesselId: string, goodId: string, quantity: number, grade?: GradeId) => void;
  onSell: (vesselId: string, goodId: string, quantity: number, grade?: GradeId) => void;
}

/**
 * The right half of Tea Race's "assign and move ships" pattern (`FleetPanel` selects the ship,
 * `PortPanel` gives her orders) — everything the selected vessel can do, always on screen and
 * reacting live to a city clicked on the map, rather than a popup that has to be opened first.
 * Structurally this is the previous 'city' menu section unchanged: `CityPreviewPanel` (what's known
 * about the clicked city, dispatch/insure/queue-route) stacked over `MarketPanel` (buy/sell at the
 * selected vessel's own dock), just relocated from a drawer to permanent chrome.
 */
export default function OrdersPanel({
  state,
  selectedVessel,
  previewCity,
  dockedCityIds,
  insureNext,
  onInsureChange,
  onConfirmDispatch,
  onQueueRoute,
  onBuy,
  onSell,
}: OrdersPanelProps) {
  const activePolicy = selectedVessel ? state.insurance.find(i => i.vesselId === selectedVessel.id) : undefined;

  return (
    <Panel title="Orders" aside={selectedVessel && <Label>{selectedVessel.name}</Label>}>
      <p style={{ ...bodySmall, fontSize: '0.8rem', margin: 0 }}>
        {selectedVessel
          ? selectedVessel.destination
            ? `${selectedVessel.name} cannot be redirected while under way.`
            : "Click any city on the map to see what's known about it."
          : 'Select a vessel from the Fleet panel.'}
      </p>

      {activePolicy && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.good }}>
          Insured for {Math.round(activePolicy.coverage)}f this voyage (premium {activePolicy.premiumPaid}f paid).
        </p>
      )}

      {previewCity && (
        <CityPreviewPanel
          city={previewCity}
          isLive={dockedCityIds.has(previewCity.id)}
          report={state.knownPrices[previewCity.id]}
          week={state.week}
          scarcity={state.scarcity}
          liveCauses={state.lastMarketCauses?.[previewCity.id]}
          marketEvents={state.marketEvents}
          vessel={selectedVessel}
          insureNext={insureNext}
          onInsureChange={onInsureChange}
          onConfirmDispatch={onConfirmDispatch}
          onQueueRoute={onQueueRoute}
        />
      )}

      {selectedVessel && !selectedVessel.destination && selectedVessel.capacity > 0 && (
        <MarketPanel
          cityId={selectedVessel.location}
          cityName={findCity(selectedVessel.location)?.name ?? selectedVessel.location}
          cash={state.cash}
          cargo={selectedVessel.cargo}
          cargoGrades={selectedVessel.cargoGrades}
          capacity={selectedVessel.capacity}
          scarcity={state.scarcity}
          causes={state.lastMarketCauses?.[selectedVessel.location]}
          marketEvents={state.marketEvents}
          onBuy={(goodId, quantity, grade) => onBuy(selectedVessel.id, goodId, quantity, grade)}
          onSell={(goodId, quantity, grade) => onSell(selectedVessel.id, goodId, quantity, grade)}
        />
      )}
    </Panel>
  );
}
