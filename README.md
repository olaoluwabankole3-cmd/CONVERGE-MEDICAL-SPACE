# Converge Medical Intelligence

A multi-tenant hospital operations workspace prototype focused on patient access, appointments, follow-ups, exceptions, and governed AI support.

## Current milestone

This first milestone is a responsive dashboard prototype using synthetic demonstration data only. It is not connected to a hospital, EHR, scheduling system, or live patient data.

## Safety principles

- Use synthetic data during prototyping.
- Never commit credentials or real patient information.
- Implement and test tenant isolation and server-side authorization before storing hospital data.
- Distinguish AI suggestions from completed actions.
- Consequential actions require permission checks, appropriate human approval, verified outcomes, and audit history.

## Planned milestones

1. Responsive dashboard and work queue.
2. Access-case workflows and contextual details.
3. Hospital registration, verification, approval, and authentication.
4. Tenant-aware persistence and server-side authorization.
5. Appointment and follow-up workflows, audit events, and governed agent registry.
