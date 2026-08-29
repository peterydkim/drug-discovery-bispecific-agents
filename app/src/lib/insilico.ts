// Typed surface over the shared sequence calculators.
//
// The implementation lives in sequence.mjs as plain JavaScript so that
// mcp/server.mjs can import the exact same code under Node. This file adds the
// TypeScript types the app compiles against; there is one implementation.

import * as impl from "./sequence.mjs";

export interface LiabilityHit {
  motif: string;
  /** 1-based position of the first residue of the motif. */
  position: number;
  risk: "high" | "moderate" | "low";
  label: string;
}

export interface SequenceReport {
  valid: boolean;
  error?: string;
  length: number;
  molecularWeightDa: number;
  molecularWeightKDa: number;
  theoreticalPI: number;
  netChargeAtPH74: number;
  extinctionCoeffReduced: number;
  extinctionCoeffCystine: number;
  a280OneGramPerLitre: number;
  gravy: number;
  aliphaticIndex: number;
  aromaticity: number;
  cysteineCount: number;
  unpairedCysteine: boolean;
  composition: Record<string, number>;
  liabilities: LiabilityHit[];
}

export interface DevelopabilityFlag {
  metric: string;
  value: string;
  verdict: "pass" | "watch" | "fail";
  basis: string;
}

export const cleanSequence = impl.cleanSequence as (raw: string) => string;
export const analyseSequence = impl.analyseSequence as (raw: string) => SequenceReport;
export const findLiabilities = impl.findLiabilities as (seq: string) => LiabilityHit[];
export const developabilityFlags = impl.developabilityFlags as (
  r: SequenceReport,
) => DevelopabilityFlag[];
export const plddtBand = impl.plddtBand as (v: number) => { label: string; tone: string };
