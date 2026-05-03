import type { HmiObject, TextStyle } from "@web-scada/shared";

const defaultTextStyle: TextStyle = {
  fontFamily: "Arial",
  fontSize: 16,
  color: "#ffffff",
  horizontalAlign: "center",
  verticalAlign: "middle",
  fontStyle: "normal",
  padding: 4,
};

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createObjectByType(type: HmiObject["type"]): HmiObject {
  switch (type) {
    case "group":
      return {
        id: id("group"),
        type,
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        minWidth: 20,
        minHeight: 20,
        objects: [],
      };
    case "text":
      return {
        id: id("text"),
        type,
        x: 80,
        y: 80,
        width: 180,
        height: 40,
        minWidth: 60,
        minHeight: 24,
        text: "New text",
        textStyle: { ...defaultTextStyle, horizontalAlign: "left" },
      };
    case "line":
      return {
        id: id("line"),
        type,
        x: 100,
        y: 100,
        width: 140,
        height: 20,
        minWidth: 20,
        minHeight: 10,
        points: [0, 10, 140, 10],
        stroke: "#d9d9d9",
        strokeWidth: 3,
      };
    case "rectangle":
      return {
        id: id("rect"),
        type,
        x: 100,
        y: 100,
        width: 140,
        height: 80,
        minWidth: 30,
        minHeight: 20,
        fill: "#262626",
        stroke: "#8c8c8c",
      };
    case "value-display":
      return {
        id: id("val"),
        type,
        x: 100,
        y: 100,
        width: 180,
        height: 40,
        minWidth: 80,
        minHeight: 28,
        tag: "Boiler.Pressure",
        suffix: " kPa",
        badQualityText: "BAD",
        textStyle: { ...defaultTextStyle, color: "#ffd666", horizontalAlign: "right" },
      };
    case "value-input":
      return {
        id: id("input"),
        type,
        x: 100,
        y: 100,
        width: 170,
        height: 44,
        minWidth: 80,
        minHeight: 28,
        tag: "Burner_1.StartCmd",
        confirm: true,
        textStyle: { ...defaultTextStyle },
      };
    case "state-indicator":
      return {
        id: id("state"),
        type,
        x: 100,
        y: 100,
        width: 160,
        height: 44,
        minWidth: 80,
        minHeight: 28,
        tag: "Burner_1.Flame",
        trueText: "ON",
        falseText: "OFF",
        trueColor: "#389e0d",
        falseColor: "#595959",
        badColor: "#bfbfbf",
        textStyle: { ...defaultTextStyle },
      };
    case "button":
      return {
        id: id("btn"),
        type,
        x: 100,
        y: 100,
        width: 130,
        height: 44,
        minWidth: 60,
        minHeight: 24,
        text: "Start",
        textStyle: { ...defaultTextStyle },
        action: { type: "pulse", tag: "Burner_1.StartCmd", value: true, durationMs: 500 },
      };
    case "switch":
      return {
        id: id("switch"),
        type,
        x: 100,
        y: 100,
        width: 130,
        height: 44,
        minWidth: 70,
        minHeight: 28,
        tag: "Burner_1.StartCmd",
        onText: "ON",
        offText: "OFF",
        textStyle: { ...defaultTextStyle },
      };
    case "image":
      return {
        id: id("img"),
        type,
        x: 100,
        y: 100,
        width: 140,
        height: 100,
        minWidth: 40,
        minHeight: 40,
        fit: "contain",
        preserveAspectRatio: true,
        opacity: 1,
      };
    case "libraryElementInstance":
      return {
        id: id("lib"),
        type,
        x: 100,
        y: 100,
        width: 180,
        height: 120,
        minWidth: 60,
        minHeight: 40,
        libraryId: "",
        elementId: "",
        scaleMode: "fit",
      };
    case "valve":
      return {
        id: id("valve"),
        type,
        x: 100,
        y: 100,
        width: 120,
        height: 90,
        minWidth: 60,
        minHeight: 50,
        label: "PZK-1",
        openTag: "Valve_1.Opened",
        closedTag: "Valve_1.Closed",
        errorTag: "Valve_1.Fault",
        textStyle: { ...defaultTextStyle, fontSize: 12 },
      };
    case "pump":
      return {
        id: id("pump"),
        type,
        x: 100,
        y: 100,
        width: 130,
        height: 90,
        minWidth: 60,
        minHeight: 50,
        label: "Fan-1",
        runTag: "Fan_1.Run",
        faultTag: "Fan_1.Fault",
        textStyle: { ...defaultTextStyle, fontSize: 12 },
      };
    case "frame":
      return {
        id: id("frame"),
        type,
        x: 100,
        y: 100,
        width: 220,
        height: 120,
        minWidth: 80,
        minHeight: 50,
        screenId: "",
        showBorder: true,
        borderColor: "#888",
        borderWidth: 1,
        scaleMode: "fit",
      };
    default:
      return {
        id: id("obj"),
        type: "text",
        x: 0,
        y: 0,
        width: 160,
        height: 40,
        text: "Unknown",
        textStyle: { ...defaultTextStyle },
      };
  }
}
