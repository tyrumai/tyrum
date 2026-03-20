import {
  AudioRecordArgs,
  AudioRecordResult,
  CameraCapturePhotoArgs,
  CameraCapturePhotoResult,
  CameraCaptureVideoArgs,
  CameraCaptureVideoResult,
  LocationGetArgs,
  LocationGetResult,
} from "@tyrum/contracts";
import {
  createEntry,
  crossPlatformSensorAction,
  type CapabilityCatalogEntry,
} from "./capability-catalog-helpers.js";

export const SENSOR_CAPABILITY_CATALOG_ENTRIES: readonly CapabilityCatalogEntry[] = [
  createEntry(
    "tyrum.location.get",
    crossPlatformSensorAction(
      "get",
      "Read the device's current geographic position.",
      LocationGetArgs,
      LocationGetResult,
      "location",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.camera.capture-photo",
    crossPlatformSensorAction(
      "capture_photo",
      "Capture a still image from a camera.",
      CameraCapturePhotoArgs,
      CameraCapturePhotoResult,
      "image",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.camera.capture-video",
    crossPlatformSensorAction(
      "capture_video",
      "Record a video clip from a camera.",
      CameraCaptureVideoArgs,
      CameraCaptureVideoResult,
      "image",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
  createEntry(
    "tyrum.audio.record",
    crossPlatformSensorAction(
      "record",
      "Record an audio clip from a microphone.",
      AudioRecordArgs,
      AudioRecordResult,
      "audio",
      {
        secure_context_required: false,
        browser_apis: [],
        hardware_may_be_required: true,
      },
    ),
  ),
];
