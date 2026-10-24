from datetime import datetime, timedelta, timezone
import unittest

from edgeodds.identity import (
    AliasRecord,
    AliasRegistry,
    AmbiguousIdentity,
    CanonicalEventRef,
    EventResolver,
    ProviderEvent,
    UnresolvedIdentity,
)


T0 = datetime(2026, 10, 25, 20, 25, tzinfo=timezone.utc)


class IdentityTests(unittest.TestCase):
    def registry(self):
        return AliasRegistry([
            AliasRecord("SEA", "nfl:sea", "fixture", "fixture:teams:v1"),
            AliasRecord("Seattle Seahawks", "nfl:sea", "fixture", "fixture:teams:v1"),
            AliasRecord("ARI", "nfl:ari", "fixture", "fixture:teams:v1"),
            AliasRecord("Arizona Cardinals", "nfl:ari", "fixture", "fixture:teams:v1"),
        ])

    def test_alias_requires_explicit_mapping(self):
        with self.assertRaises(UnresolvedIdentity):
            self.registry().resolve("Seattle", provider="fixture")

    def test_provider_scope_prevents_cross_provider_guess(self):
        with self.assertRaises(UnresolvedIdentity):
            self.registry().resolve("SEA", provider="other-provider")

    def test_ambiguous_alias_is_not_auto_resolved(self):
        reg = self.registry()
        reg.add(AliasRecord("SEA", "wnba:sea", "fixture", "fixture:bad-collision"))
        with self.assertRaises(AmbiguousIdentity):
            reg.resolve("SEA", provider="fixture")

    def test_event_resolution_requires_exact_participants_and_time(self):
        resolver = EventResolver(
            self.registry(),
            [CanonicalEventRef("nfl:2026:ari@sea:1", "NFL", "nfl:ari", "nfl:sea", T0)],
        )
        match = resolver.resolve(
            ProviderEvent("fixture", "native-1", "NFL", "ARI", "SEA", T0 + timedelta(minutes=2))
        )
        self.assertEqual(match.event.event_id, "nfl:2026:ari@sea:1")
        self.assertEqual(match.start_delta_seconds, 120)

    def test_doubleheader_like_multiple_candidates_stays_ambiguous(self):
        resolver = EventResolver(
            self.registry(),
            [
                CanonicalEventRef("game-1", "NFL", "nfl:ari", "nfl:sea", T0),
                CanonicalEventRef("game-2", "NFL", "nfl:ari", "nfl:sea", T0 + timedelta(minutes=15)),
            ],
        )
        with self.assertRaises(AmbiguousIdentity):
            resolver.resolve(
                ProviderEvent("fixture", "native-1", "NFL", "ARI", "SEA", T0 + timedelta(minutes=5)),
                tolerance=timedelta(minutes=20),
            )

    def test_wrong_participants_do_not_match(self):
        resolver = EventResolver(
            self.registry(),
            [CanonicalEventRef("game-1", "NFL", "nfl:ari", "nfl:sea", T0)],
        )
        with self.assertRaises(UnresolvedIdentity):
            resolver.resolve(
                ProviderEvent("fixture", "native-2", "NFL", "SEA", "ARI", T0)
            )

    def test_provider_venue_evidence_must_match(self):
        resolver = EventResolver(
            self.registry(),
            [
                CanonicalEventRef("game-a", "NFL", "nfl:ari", "nfl:sea", T0, venue_id="stadium-a"),
                CanonicalEventRef("game-b", "NFL", "nfl:ari", "nfl:sea", T0, venue_id="stadium-b"),
            ],
        )
        match = resolver.resolve(
            ProviderEvent(
                "fixture", "native-venue", "NFL", "ARI", "SEA", T0,
                venue_id="stadium-b",
            )
        )
        self.assertEqual(match.event.event_id, "game-b")

    def test_neutral_site_evidence_must_match_when_supplied(self):
        resolver = EventResolver(
            self.registry(),
            [
                CanonicalEventRef(
                    "neutral", "NFL", "nfl:ari", "nfl:sea", T0,
                    venue_id="stadium-n", neutral_site=True,
                ),
                CanonicalEventRef(
                    "home", "NFL", "nfl:ari", "nfl:sea", T0,
                    venue_id="stadium-h", neutral_site=False,
                ),
            ],
        )
        match = resolver.resolve(
            ProviderEvent(
                "fixture", "native-neutral", "NFL", "ARI", "SEA", T0,
                neutral_site=True,
            )
        )
        self.assertEqual(match.event.event_id, "neutral")

    def test_missing_venue_evidence_does_not_guess_between_candidates(self):
        resolver = EventResolver(
            self.registry(),
            [
                CanonicalEventRef("game-a", "NFL", "nfl:ari", "nfl:sea", T0, venue_id="stadium-a"),
                CanonicalEventRef("game-b", "NFL", "nfl:ari", "nfl:sea", T0, venue_id="stadium-b"),
            ],
        )
        with self.assertRaises(AmbiguousIdentity):
            resolver.resolve(
                ProviderEvent("fixture", "native-ambiguous", "NFL", "ARI", "SEA", T0)
            )

    def test_material_reschedule_requires_reconciliation(self):
        resolver = EventResolver(
            self.registry(),
            [CanonicalEventRef("game-1", "NFL", "nfl:ari", "nfl:sea", T0)],
        )
        with self.assertRaises(UnresolvedIdentity):
            resolver.resolve(
                ProviderEvent(
                    "fixture", "native-rescheduled", "NFL", "ARI", "SEA",
                    T0 + timedelta(hours=3),
                )
            )


if __name__ == "__main__":
    unittest.main()
