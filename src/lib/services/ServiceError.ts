import type { NextResponse } from 'next/server';

// Code shared by every CodedServiceError subclass — the "every domain
// service can report an internal failure" convention hoisted into the
// type system. Concrete domain code unions compose it:
//
//   type WeatherServiceErrorCode = ServiceErrorCode | 'CITY_NOT_FOUND' | ...
//
// Single-sources the string literal so a future shared code (e.g.
// 'RATE_LIMITED') propagates to every domain error union by editing
// one line here.
export type ServiceErrorCode = 'INTERNAL_ERROR';

// Abstract base for every error the API layer can serialize into an
// HTTP response. Each subclass owns its own status + body + side-effects
// via toApiResponse(); apiErrorResponse just classifies the incoming
// error into a ServiceError instance and lets polymorphism do the rest.
//
// The runtime classifier (unknown → ServiceError) lives in
// apiErrorResponse.ts rather than as a static on this class, so this
// base has no dependency on its concrete subclasses — avoids the
// circular-import trap that ESM would otherwise trigger.
export abstract class ServiceError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // Auto-populate this.name from the concrete subclass invoked via
    // `new`. Keeps stack traces / logs meaningful ("WeatherServiceError:
    // City not found." instead of "Error: City not found.") without
    // requiring every subclass to hardcode `this.name = 'Foo'`.
    // new.target is the actual constructor called with `new`, so
    // renaming a subclass never leaves a stale name string behind.
    this.name = new.target.name;
  }

  abstract toApiResponse(): NextResponse;
}
