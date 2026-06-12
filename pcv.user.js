// ==UserScript==
// @name         Foresight Plus
// @namespace    local.foresight.plus
// @version      44.0
// @description  Foresight Plus v44: single-scroll dashboard with Grafana bridge, STEM associates, VAST alerts, allocations, and Top Recirc.
// @author       janazare
// @match        https://sort.aka.amazon.com/foresight/*
// @match        https://sort-eu.aka.amazon.com/foresight/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      grafana-prod.prod.us-east-1.grafana.insights.aft.amazon.dev
// @match        https://grafana-prod.prod.us-east-1.grafana.insights.aft.amazon.dev/*
// @match        https://stem-na.corp.amazon.com/*
// @match        https://na.vast.ops-integration.amazon.dev/*
// @grant        unsafeWindow
// @connect      sort.aka.amazon.com
// @connect      na.prod.wattwebsite.sorttech.amazon.dev
// @connect      stem-na.corp.amazon.com
// @connect      api.na.vast.ops-integration.amazon.dev
// @connect      na.vast.ops-integration.amazon.dev
// ==/UserScript==

// creator: @janazare
// mark: FCV-PRO-JANAZARE-31

// creator: @janazare
// mark: FCV-PRO-JANAZARE-34

(function () {
    'use strict';

    // ======================================================
    // Foresight Plus
    // Original enhancement set by janazare
    // FCV-JZ-001 / FGLWB-JZ-001
    // ======================================================

    const BUILD = {
        name: "Foresight Plus",
        version: "44.0",
        author: "janazare",
        signature: "FORESIGHT-PLUS-JANAZARE-44"
    };

    const CONFIG = {
        recircThreshold: 10,
        severeRecircThreshold: 20,
        refreshMs: 1500,
        grafanaRefreshMs: 5000,
        allocationScheduleMinutes: [11, 41],
        scanDelayMs: 650,
        maxGrafanaItems: 8,
        maxTopRecircItems: 5,
        allocationAreaOrder: ["SR", "FR1", "FR0", "FR2"],
        ids: {
            control: "fcv-pro-control-bar",
            legend: "fcv-pro-legend",
            grafana: "fcv-pro-grafana-panel",
            allocations: "fcv-pro-allocations-panel",
            topRecirc: "fcv-pro-top-recirc",
            allTable: "fcv-pro-all-table",
            allocationFrame: "fcv-pro-allocation-frame",
            grafanaBadge: "fcv-pro-grafana-badge"
        },
        storage: {
            grafana: "FCV_PRO_GRAFANA_LANE_WATCH_CACHE_V1",
            grafanaDiag: "FCV_PRO_GRAFANA_DIAGNOSTICS_V1",
            allocations: "FCV_PRO_ALLOCATIONS_CACHE_V1",
            prefs: "FCV_PRO_PREFS_V1"
        }
    };

    const CHUTE_COLORS = {
        SR: "#8E44AD",
        FR0: "#E67E22",
        FR1: "#00A6D6",
        FR2: "#F1C40F",
        DD: "#1F4E79"
    };

    const STATUS_COLORS = {
        available: "#90EE90",
        recirc: "#66A3FF",
        unavailable: "#E5E5E5",
        disabled: "#A9A9A9",
        failed: "#FF4D4D",
        pending: "#FFFF00",
        open: "#FFA500"
    };

    const AREA_ORDER = ["SR", "FR1", "FR0", "FR2", "DD"];

    const AREA_LABELS = {
        SR: "Spirals",
        FR1: "Flats",
        FR0: "High Velocity",
        FR2: "High Velocity 2.0",
        DD: "Fluids"
    };

    const GRAFANA_LANE_NAME_MAP = {
        S011501: "West Jackpot 1501",
        S010941: "Main Jackpot Short Chute 941",
        S010942: "Main Jackpot Long Chute 942",
        S010441: "East Jackpot 441",
        S010931: "Spirals Bypass 931",
        S011511: "Flats Bypass 1511"
    };

    const STATE = {
        collapsed: false,
        hidden: false,
        lastAutoLaneScanMs: 0,
        lastPageHarvestMs: 0,
        lastAutoRecircSortMs: 0,
        panels: {
            legend: false,
            grafana: true,
            allocations: true,
            topRecirc: true,
            vast: true,
            allTable: false
        },
        filters: {
            recircOnly: false,
            hideDisabled: false,
            families: new Set()
        },
        scanRunning: false,
        laneCache: new Map(),
        headers: [],
        sortIndex: null,
        sortDirection: "desc"
    };

    const DEFAULT_PANEL_STATE = JSON.parse(JSON.stringify(STATE.panels));

    GM_addStyle(`
#fcv-pro-control-bar,
#fcv-pro-legend,
#fcv-pro-grafana-panel,
#fcv-pro-allocations-panel,
#fcv-pro-top-recirc,
#fcv-pro-all-table {
    box-sizing: border-box;
    width: 100%;
    font-family: Arial, sans-serif;
}

#fcv-pro-control-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 8px 0 6px 0;
    padding: 8px 10px;
    background: #111827;
    color: #ffffff;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 1px 3px rgba(0,0,0,.18);
}

#fcv-pro-control-bar .fcv-pro-title {
    font-size: 14px;
    font-weight: 900;
    margin-right: 8px;
}

#fcv-pro-control-bar.fcv-pro-collapsed {
    position: sticky;
    top: 0;
    z-index: 9999;
    margin-bottom: 8px;
}

#fcv-pro-control-bar.fcv-pro-collapsed .fcv-pro-toggle-buttons,
#fcv-pro-control-bar.fcv-pro-collapsed #fcv-pro-scan,
#fcv-pro-control-bar.fcv-pro-collapsed #fcv-pro-reset {
    display: none !important;
}

body.fcv-pro-master-collapsed #fcv-pro-legend,
body.fcv-pro-master-collapsed #fcv-pro-grafana-panel,
body.fcv-pro-master-collapsed #fcv-pro-allocations-panel,
body.fcv-pro-master-collapsed #fcv-pro-top-recirc,
body.fcv-pro-master-collapsed #fcv-pro-all-table {
    display: none !important;
}

#fcv-pro-show-tab {
    position: fixed;
    top: 6px;
    right: 10px;
    z-index: 99999;
    background: #111827;
    color: #ffffff;
    border: 1px solid #374151;
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.28);
}

#fcv-pro-show-tab:hover {
    background: #1f2937;
}

body.fcv-pro-master-hidden #fcv-pro-control-bar,
body.fcv-pro-master-hidden #fcv-pro-legend,
body.fcv-pro-master-hidden #fcv-pro-grafana-panel,
body.fcv-pro-master-hidden #fcv-pro-allocations-panel,
body.fcv-pro-master-hidden #fcv-pro-top-recirc,
body.fcv-pro-master-hidden #fcv-pro-all-table {
    display: none !important;
}


#fcv-pro-control-bar button,
#fcv-pro-legend button,
#fcv-pro-grafana-panel button {
    font-size: 12px;
    font-weight: 800;
    padding: 3px 8px;
    border: 1px solid #879596;
    border-radius: 5px;
    background: #f7fafa;
    color: #111111;
    cursor: pointer;
}

#fcv-pro-control-bar button:hover,
#fcv-pro-legend button:hover,
#fcv-pro-grafana-panel button:hover {
    background: #eaeded;
}

#fcv-pro-control-bar button.fcv-pro-active,
#fcv-pro-legend button.fcv-pro-active {
    background: #22c55e;
    color: #111111;
    border-color: #22c55e;
}

#fcv-pro-control-bar button.fcv-pro-off {
    background: #374151;
    color: #ffffff;
    border-color: #4b5563;
}

#fcv-pro-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px 10px;
    margin: 0 0 6px 0;
    padding: 7px 9px;
    background: #ffffff;
    border: 1px solid #d5dbdb;
    border-radius: 6px;
    color: #111111;
    font-size: 12px;
    line-height: 18px;
    box-shadow: 0 1px 2px rgba(0,0,0,.06);
}

#fcv-pro-legend span {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    font-weight: 800;
}

#fcv-pro-legend b {
    display: inline-block;
    width: 13px;
    height: 13px;
    min-width: 13px;
    margin-right: 5px;
    border: 1px solid #222;
    border-radius: 2px;
}

#fcv-pro-legend .fcv-pro-controls {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
}

.fcv-pro-panel {
    margin: 0 0 6px 0;
    background: #ffffff;
    border: 1px solid #d5dbdb;
    border-radius: 6px;
    color: #111111;
    font-size: 12px;
    line-height: 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,.06);
    overflow: hidden;
}

.fcv-pro-panel-title {
    background: linear-gradient(90deg, #8E44AD 0%, #00A6D6 25%, #E67E22 50%, #F1C40F 75%, #1F4E79 100%);
    color: #ffffff;
    font-size: 13px;
    font-weight: 900;
    text-align: center;
    padding: 5px 8px;
    text-shadow: 0 1px 2px rgba(0,0,0,.35);
}

.fcv-pro-panel-subtitle {
    background: #f7fafa;
    color: #374151;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    padding: 4px 8px;
    border-bottom: 1px solid #d5dbdb;
}

#fcv-pro-grafana-panel .fcv-pro-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(140px, 1fr));
}

#fcv-pro-grafana-panel .fcv-pro-card {
    border-right: 1px solid #d5dbdb;
    min-height: 60px;
}

#fcv-pro-grafana-panel .fcv-pro-card:last-child {
    border-right: none;
}

#fcv-pro-grafana-panel .fcv-pro-card-title {
    font-weight: 900;
    padding: 4px 6px;
    background: #f7fafa;
    border-bottom: 1px solid #d5dbdb;
    text-align: center;
}

#fcv-pro-grafana-panel .fcv-pro-list {
    padding: 4px 6px;
}

.fcv-pro-item {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-weight: 800;
    padding: 1px 0;
    border-bottom: 1px solid #f0f0f0;
}

.fcv-pro-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fcv-pro-item-count {
    min-width: 28px;
    text-align: right;
}

.fcv-pro-severe {
    color: #D13212;
    font-weight: 900;
}

.fcv-pro-warning {
    color: #B45309;
    font-weight: 900;
}

.fcv-pro-good {
    color: #2E7D32;
    font-weight: 900;
}

.fcv-pro-empty {
    color: #777777;
    font-style: italic;
    font-weight: 700;
    text-align: center;
    padding: 6px;
}

.fcv-pro-actions {
    display: flex;
    justify-content: center;
    gap: 6px;
    padding: 5px;
    background: #f7fafa;
    border-top: 1px solid #d5dbdb;
}

#fcv-pro-allocations-panel table,
#fcv-pro-top-recirc table,
#fcv-pro-all-table table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

#fcv-pro-allocations-panel th,
#fcv-pro-allocations-panel td,
#fcv-pro-top-recirc th,
#fcv-pro-top-recirc td {
    border: 1px solid #d5dbdb;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
}

#fcv-pro-allocations-panel .fcv-pro-header-row th,
#fcv-pro-top-recirc .fcv-pro-area-row th {
    font-size: 12px;
    font-weight: 900;
    text-align: center;
    background: #f7fafa;
}

.fcv-pro-status-pill {
    display: inline-block;
    min-width: 70px;
    padding: 2px 6px;
    border-radius: 999px;
    font-weight: 900;
    text-align: center;
    border: 1px solid rgba(0,0,0,.15);
}

.fcv-pro-subtext {
    color: #555;
    font-size: 10px;
    font-weight: 700;
}

#fcv-pro-all-table {
    max-height: 70vh;
    overflow: auto;
}

#fcv-pro-all-table .fcv-pro-all-title {
    position: sticky;
    top: 0;
    z-index: 4;
    background: #111827;
    color: #fff;
    padding: 6px 9px;
    font-size: 13px;
    font-weight: 900;
}

#fcv-pro-all-table th {
    position: sticky;
    top: 31px;
    z-index: 3;
    background: #f7fafa;
    border: 1px solid #d5dbdb;
    padding: 5px 7px;
    text-align: left;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
}

#fcv-pro-all-table td {
    border: 1px solid #d5dbdb;
    padding: 4px 7px;
    font-size: 11px;
    white-space: nowrap;
}

.fcv-pro-chute-zone {
    font-weight: 700 !important;
}

tr.fcv-pro-row-hidden {
    display: none !important;
}

body.fcv-pro-all-mode .awsui-table-container {
    display: none !important;
}

#fcv-pro-grafana-badge {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 99999;
    background: #111827;
    color: #ffffff;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
}


#fcv-pro-control-bar {
    justify-content: space-between !important;
    position: relative !important;
    top: auto !important;
    z-index: 100 !important;
}

#fcv-pro-control-bar .fcv-pro-left-controls,
#fcv-pro-control-bar .fcv-pro-right-controls {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

#fcv-pro-hide-all,
#fcv-pro-show-tab,
#fcv-pro-scan,
button[data-panel="allTable"] {
    display: none !important;
}

/* Do not hide the native Foresight table anymore. This fixes the scrolling/table disappearing issue. */
body.fcv-pro-all-mode .awsui-table-container {
    display: block !important;
}

#fcv-pro-all-table {
    display: none !important;
}





#fcv-pro-allocation-frame {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
    border: 0 !important;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-area-table {
    width: 100%;
    table-layout: fixed !important;
    border-collapse: collapse;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-area-table th {
    color: #ffffff;
    text-align: center;
    font-size: 11px !important;
    padding: 4px 5px !important;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-area-table td {
    vertical-align: top !important;
    padding: 3px 4px !important;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-card {
    margin: 0 0 3px 0;
    padding: 3px 4px;
    border-radius: 4px;
    border: 1px solid #d5dbdb;
    background: #ffffff;
    line-height: 12px;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-status-line {
    margin-top: 2px;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-empty-area {
    color: #777777;
    font-style: italic;
    text-align: center;
    font-weight: 700;
    padding: 5px;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-meta {
    background: #FFF7CC;
    color: #111111;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
    padding: 3px 6px;
    border-bottom: 1px solid #d5dbdb;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-chute {
    display: inline-block;
    min-width: 72px;
    padding: 1px 5px;
    border-radius: 4px;
    font-weight: 900;
    text-align: center;
    margin-right: 5px;
    border: 1px solid rgba(0,0,0,.25);
}

#fcv-pro-allocations-panel .fcv-pro-allocation-filter {
    font-weight: 900;
}




/* v29 solid, calmer title bars */
#fcv-pro-grafana-panel .fcv-pro-panel-title {
    background: #1F4E79 !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

#fcv-pro-allocations-panel .fcv-pro-panel-title {
    background: #2E7D32 !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

#fcv-pro-top-recirc .fcv-pro-panel-title {
    background: #374151 !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

/* v29 legend lives in static top row */
#fcv-pro-control-bar .fcv-pro-inline-legend {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin-left: 8px;
}

#fcv-pro-control-bar .fcv-pro-inline-legend span {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 900;
    color: #ffffff;
}

#fcv-pro-control-bar .fcv-pro-inline-legend b {
    width: 10px;
    height: 10px;
    min-width: 10px;
    display: inline-block;
    border-radius: 2px;
    border: 1px solid rgba(255,255,255,.7);
    margin-right: 3px;
}

#fcv-pro-legend,
button[data-panel="legend"] {
    display: none !important;
}

/* v29 allocation cards: chute + status same line, proposed allocation below */
#fcv-pro-allocations-panel .fcv-pro-allocation-card {
    padding: 2px 3px !important;
    margin: 0 0 2px 0 !important;
    line-height: 11px !important;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-topline {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: space-between;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-chute {
    min-width: auto !important;
    padding: 1px 4px !important;
    margin-right: 0 !important;
    font-size: 10px !important;
    line-height: 12px !important;
}

#fcv-pro-allocations-panel .fcv-pro-status-pill {
    min-width: auto !important;
    padding: 1px 5px !important;
    font-size: 9px !important;
    line-height: 12px !important;
    white-space: nowrap;
}

#fcv-pro-allocations-panel .fcv-pro-subtext {
    margin-top: 1px;
    font-size: 9px !important;
    line-height: 10px !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-filter {
    display: none !important;
}

#fcv-pro-grafana-panel .fcv-pro-panel-subtitle {
    display: none !important;
}

/* v28 compact title rows */
#fcv-pro-grafana-panel .fcv-pro-panel-title,
#fcv-pro-allocations-panel .fcv-pro-panel-title,
#fcv-pro-top-recirc .fcv-pro-panel-title {
    min-height: 18px;
}

#fcv-pro-allocations-panel .fcv-pro-title-row .fcv-pro-title-pill {
    background: #008000 !important;
}

#fcv-pro-allocations-panel .fcv-pro-title-row .fcv-pro-title-meta {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    margin-right: 150px;
    color: #ffffff;
    font-size: 10px;
    font-weight: 800;
    white-space: nowrap;
}

#fcv-pro-grafana-panel .fcv-pro-grid {
    grid-template-columns: repeat(2, minmax(180px, 1fr)) !important;
}

#fcv-pro-grafana-panel .fcv-pro-actions {
    display: none !important;
}

#fcv-pro-grafana-panel .fcv-pro-item-name {
    font-weight: 900;
}

#fcv-pro-grafana-panel .fcv-pro-item {
    padding: 2px 6px !important;
}

#fcv-pro-top-recirc .fcv-pro-top-line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
}

#fcv-pro-top-recirc .fcv-pro-top-lane {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#fcv-pro-top-recirc .fcv-pro-top-count {
    min-width: 24px;
    text-align: right;
}

/* v26 sticky: only FCV Pro bar and legend */
#fcv-pro-control-bar {
    position: relative !important;
    top: auto !important;
    z-index: 100 !important;
}

#fcv-pro-legend {
    position: relative !important;
    top: auto !important;
    z-index: 100 !important;
}

/* v26 title bars with right-side timer/status pill */
.fcv-pro-title-row {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
}

.fcv-pro-title-row .fcv-pro-title-main {
    font-weight: 900;
}

.fcv-pro-title-row .fcv-pro-title-pill {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: #008000;
    color: #ffffff;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 900;
    text-shadow: none;
    white-space: nowrap;
}

#fcv-pro-grafana-panel .fcv-pro-title-row .fcv-pro-title-pill {
    background: #1F4E79;
}

/* v26 Top Recirc row backgrounds matching Grafana severity style */
#fcv-pro-top-recirc .fcv-pro-top-line {
    margin: 0 0 2px 0;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 900;
    border-bottom: 1px solid #e5e7eb;
}

#fcv-pro-top-recirc .fcv-pro-top-good {
    background: #E8F5E9;
    color: #2E7D32;
}

#fcv-pro-top-recirc .fcv-pro-top-warning {
    background: #FFF4D6;
    color: #B45309;
}

#fcv-pro-top-recirc .fcv-pro-top-severe {
    background: #FDE2E1;
    color: #D13212;
}

#fcv-pro-allocations-panel .fcv-pro-allocation-meta {
    display: none !important;
}

/* prevent the old v22 override from making legend non-sticky */

/* v23 Grafana severity colors: original Grafana-style green / orange / red */
#fcv-pro-grafana-panel {
    border-left: 5px solid #2E7D32 !important;
}

#fcv-pro-grafana-panel .fcv-pro-panel-title {
    background: linear-gradient(90deg, #2E7D32 0%, #F59E0B 55%, #D13212 100%) !important;
}

#fcv-pro-grafana-panel .fcv-pro-card-title {
    background: #111827 !important;
    color: #ffffff !important;
}

#fcv-pro-grafana-panel .fcv-pro-item {
    border-bottom: 1px solid #e5e7eb !important;
    padding: 2px 4px !important;
    border-radius: 3px;
}

#fcv-pro-grafana-panel .fcv-pro-item:has(.fcv-pro-good) {
    background: #E8F5E9;
}

#fcv-pro-grafana-panel .fcv-pro-item:has(.fcv-pro-warning) {
    background: #FFF4D6;
}

#fcv-pro-grafana-panel .fcv-pro-item:has(.fcv-pro-severe) {
    background: #FDE2E1;
}

#fcv-pro-grafana-panel .fcv-pro-good {
    color: #2E7D32 !important;
}

#fcv-pro-grafana-panel .fcv-pro-warning {
    color: #B45309 !important;
}

#fcv-pro-grafana-panel .fcv-pro-severe {
    color: #D13212 !important;
}


#fcv-pro-grafana-panel .fcv-pro-good-row { background: #E8F5E9 !important; }
#fcv-pro-grafana-panel .fcv-pro-warning-row { background: #FFF4D6 !important; }
#fcv-pro-grafana-panel .fcv-pro-severe-row { background: #FDE2E1 !important; }

/* v23 Allocations: compact, allocation-page-inspired green / yellow / red */
#fcv-pro-allocations-panel {
    border-left: 5px solid #F59E0B !important;
}

#fcv-pro-allocations-panel .fcv-pro-panel-title {
    background: linear-gradient(90deg, #F59E0B 0%, #FACC15 45%, #22C55E 100%) !important;
    color: #111111 !important;
    text-shadow: none !important;
}

#fcv-pro-allocations-panel table {
    table-layout: auto !important;
}

#fcv-pro-allocations-panel th,
#fcv-pro-allocations-panel td {
    padding: 2px 5px !important;
    font-size: 11px !important;
    line-height: 13px !important;
    vertical-align: middle !important;
}

#fcv-pro-allocations-panel .fcv-pro-header-row th {
    background: #FFF7CC !important;
    color: #111111 !important;
}

#fcv-pro-allocations-panel .fcv-pro-subtext {
    font-size: 9px !important;
    line-height: 10px !important;
    opacity: .75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 520px;
}

#fcv-pro-allocations-panel .fcv-pro-status-pill {
    min-width: 66px !important;
    padding: 1px 6px !important;
    font-size: 10px !important;
    line-height: 13px !important;
    border-radius: 999px !important;
}

/* Distinguish allocation rows by status without making the table bulky */
#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="00FF00"]) td,
#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="22C55E"]) td {
    background: #E8F5E9;
}

#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="FFFF00"]) td,
#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="FACC15"]) td {
    background: #FFFDE7;
}

#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="FF4D4D"]) td,
#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="D13212"]) td {
    background: #FDE2E1;
}

#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="FFA500"]) td,
#fcv-pro-allocations-panel tr:has(.fcv-pro-status-pill[style*="F59E0B"]) td {
    background: #FFF4D6;
}

/* v22 scroll safety: never trap page scrolling */
html,
body {
    overflow-y: auto !important;
    overflow-x: auto !important;
    height: auto !important;
}

#fcv-pro-control-bar {
    position: relative !important;
    top: auto !important;
    z-index: 100 !important;
}

#fcv-pro-legend,
#fcv-pro-grafana-panel,
#fcv-pro-allocations-panel,
#fcv-pro-top-recirc {
    position: relative !important;
    max-height: none !important;
    overflow: visible !important;
}

#fcv-pro-control-bar.fcv-pro-collapsed {
    position: relative !important;
    top: auto !important;
}

body.fcv-pro-master-collapsed #fcv-pro-legend,
body.fcv-pro-master-collapsed #fcv-pro-grafana-panel,
body.fcv-pro-master-collapsed #fcv-pro-allocations-panel,
body.fcv-pro-master-collapsed #fcv-pro-top-recirc,
body.fcv-pro-master-collapsed #fcv-pro-all-table {
    display: none !important;
}

body.fcv-pro-master-collapsed,
body.fcv-pro-master-hidden,
body.fcv-pro-all-mode {
    overflow-y: auto !important;
    height: auto !important;
}


#fcv-pro-control-bar { position: relative !important; top: auto !important; z-index: 100 !important; }
#fcv-pro-legend { position: relative !important; top: auto !important; z-index: 100 !important; }
#fcv-pro-grafana-panel, #fcv-pro-allocations-panel, #fcv-pro-top-recirc { position: relative !important; top: auto !important; }

/* v30: top controls are static, not sticky */
#fcv-pro-control-bar {
    position: relative !important;
    top: auto !important;
    z-index: 100 !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 8px !important;
    background: #111827 !important;
}

#fcv-pro-control-bar .fcv-pro-title {
    display: none !important;
}

#fcv-pro-control-bar .fcv-pro-left-controls {
    display: inline-flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    flex: 1 1 auto !important;
}

#fcv-pro-control-bar .fcv-pro-right-controls {
    display: inline-flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
    justify-content: flex-end !important;
}

#fcv-pro-control-bar .fcv-pro-inline-legend {
    display: inline-flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 6px 8px !important;
    margin-left: 0 !important;
}

#fcv-pro-control-bar .fcv-pro-inline-legend span {
    display: inline-flex !important;
    align-items: center !important;
    white-space: nowrap !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    color: #ffffff !important;
}

#fcv-pro-control-bar .fcv-pro-inline-legend b {
    width: 11px !important;
    height: 11px !important;
    min-width: 11px !important;
    display: inline-block !important;
    border-radius: 2px !important;
    border: 1px solid rgba(255,255,255,.75) !important;
    margin-right: 3px !important;
}

#fcv-pro-legend,
button[data-panel="legend"],
#fcv-pro-reset {
    display: none !important;
}

/* v30: solid title bars */
#fcv-pro-grafana-panel .fcv-pro-panel-title {
    background: #1F4E79 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

#fcv-pro-allocations-panel .fcv-pro-panel-title {
    background: #2E7D32 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

#fcv-pro-top-recirc .fcv-pro-panel-title {
    background: #374151 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}

/* v30: prevent Foresight/AWS table header from sticking in the middle of the page */
.awsui-table-container,
.awsui-table-container *,
[class*="awsui-table-container"],
[class*="awsui-table-container"] *,
table thead,
table thead tr,
table thead th {
    position: static !important;
    top: auto !important;
    bottom: auto !important;
    transform: none !important;
}

/* keep page scrolling normal */
html,
body {
    overflow-y: auto !important;
    height: auto !important;
}

#fcv-pro-control-bar.fcv-pro-collapsed {
    position: relative !important;
    top: auto !important;
}





/* FCV Pro v36: safer panel-only dark mode and sticky-table fix */
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
    margin: 0 !important;
    border-radius: 0 !important;
}

body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}

/* Disable Foresight/AWS sticky table pieces that float mid-page */
.awsui-table-container [style*="sticky"],
.awsui-table-container [class*="sticky"],
.awsui-table-container [class*="Sticky"],
[class*="awsui-table"] [style*="sticky"],
[class*="awsui-table"] [class*="sticky"],
[class*="awsui-table"] [class*="Sticky"],
table thead,
table thead tr,
table thead th {
    position: static !important;
    top: auto !important;
    bottom: auto !important;
    transform: none !important;
}

/* Panel-only dark mode. Do not darken the entire Foresight page. */
body.fcv-pro-dark-mode #fcv-pro-grafana-panel,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel,
body.fcv-pro-dark-mode #fcv-pro-top-recirc {
    background: #111827 !important;
    color: #e5e7eb !important;
    border-color: #374151 !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel table,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel table,
body.fcv-pro-dark-mode #fcv-pro-top-recirc table,
body.fcv-pro-dark-mode #fcv-pro-grafana-panel td,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel td,
body.fcv-pro-dark-mode #fcv-pro-top-recirc td,
body.fcv-pro-dark-mode #fcv-pro-grafana-panel th,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel th,
body.fcv-pro-dark-mode #fcv-pro-top-recirc th {
    border-color: #374151 !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-card-title,
body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-actions,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel .fcv-pro-actions,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-actions {
    background: #1f2937 !important;
    color: #e5e7eb !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-empty,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel .fcv-pro-empty,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-empty,
body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-subtext,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel .fcv-pro-subtext,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-subtext {
    color: #cbd5e1 !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-good-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-good {
    background: #12351f !important;
    color: #86efac !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-warning-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-warning {
    background: #422f0b !important;
    color: #fbbf24 !important;
}

body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-severe-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-severe {
    background: #451a1a !important;
    color: #fca5a5 !important;
}


/* FCV Pro v37 vertical creator mark */
#fcv-pro-creator-signature {
    position: fixed !important;
    left: 3px !important;
    bottom: 8px !important;
    z-index: 2147483001 !important;
    writing-mode: vertical-rl !important;
    transform: rotate(180deg) !important;
    font-size: 10px !important;
    line-height: 10px !important;
    font-weight: 800 !important;
    letter-spacing: .5px !important;
    color: rgba(255, 255, 255, 0.18) !important;
    background: transparent !important;
    pointer-events: none !important;
    user-select: none !important;
    text-shadow: 0 1px 1px rgba(0,0,0,.25) !important;
}

@media(max-width:900px){
    #fcv-pro-grafana-panel .fcv-pro-grid{grid-template-columns:1fr}
    #fcv-pro-grafana-panel .fcv-pro-card{border-right:none;border-bottom:1px solid #d5dbdb}
}
`);

    function norm(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function lower(value) {
        return norm(value).toLowerCase();
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function isGrafanaPage() {
        return location.hostname.includes("grafana-prod.prod.us-east-1.grafana.insights.aft.amazon.dev");
    }

    function isStemPage() {
        return location.hostname.includes("stem-na.corp.amazon.com");
    }

    function isVastPage() {
        return location.hostname.includes("vast.ops-integration.amazon.dev");
    }

    function isForesightPage() {
        return location.hostname.includes("sort.aka.amazon.com") ||
               location.hostname.includes("sort-eu.aka.amazon.com");
    }

    function loadPrefs() {
        try {
            const saved = GM_getValue(CONFIG.storage.prefs, {});
            if (typeof saved.collapsed === "boolean") STATE.collapsed = saved.collapsed;
            if (typeof saved.hidden === "boolean") STATE.hidden = saved.hidden;
            if (saved.panels) Object.assign(STATE.panels, saved.panels);
        } catch (e) {}
    }

    function savePrefs() {
        try {
            GM_setValue(CONFIG.storage.prefs, { collapsed: STATE.collapsed, hidden: STATE.hidden, panels: STATE.panels });
        } catch (e) {}
    }

    function colorText(bg) {
        return [CHUTE_COLORS.SR, CHUTE_COLORS.FR0, CHUTE_COLORS.DD].includes(bg) ? "#ffffff" : "#111111";
    }

    function countClass(n) {
        if (n >= CONFIG.severeRecircThreshold) return "fcv-pro-severe";
        if (n >= CONFIG.recircThreshold) return "fcv-pro-warning";
        return "fcv-pro-good";
    }

    function grafanaDisplayName(lane) {
        const normalized = norm(lane).toUpperCase();
        return GRAFANA_LANE_NAME_MAP[normalized] || normalized;
    }

    function grafanaLaneShouldDisplay(lane) {
        const normalized = norm(lane).toUpperCase();

        if (GRAFANA_LANE_NAME_MAP[normalized]) return true;
        if (normalized.startsWith("SR-")) return true;
        if (normalized.startsWith("FR-")) return true;
        if (normalized.startsWith("DD")) return true;

        // Hide raw sorter S-codes unless they are mapped to MJP/WJP/EJP/etc.
        if (/^S\d{5,6}$/.test(normalized)) return false;

        return false;
    }

    function isBlankOrDash(value) {
        const text = lower(value);
        return text === "" || text === "-" || text === "null" || text === "none";
    }

    function getBuildingFromUrl() {
        const url = new URL(location.href);
        const grafanaBuilding = url.searchParams.get("var-building");
        if (grafanaBuilding) return grafanaBuilding;

        const parts = location.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("foresight");
        return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "UNKNOWN";
    }

    function getSorterFromUrl() {
        const url = new URL(location.href);
        const sorter = url.searchParams.get("var-Sorter");
        const subSorter = url.searchParams.get("var-Sub_Sorter");
        if (sorter || subSorter) return [sorter, subSorter].filter(Boolean).join(" / ");

        const parts = location.pathname.split("/").filter(Boolean);
        return parts[parts.length - 1] || "UNKNOWN";
    }

    function getAnchor() {
        const input =
            document.querySelector('input[type="search"]') ||
            Array.from(document.querySelectorAll("input")).find(i => {
                const p = lower(i.getAttribute("placeholder"));
                const a = lower(i.getAttribute("aria-label"));
                return p.includes("search") || p.includes("filter") || a.includes("search");
            });

        if (input && input.parentElement) return { mode: "after", el: input.parentElement };

        const table = document.querySelector("table");
        const container = table && (table.closest(".awsui-table-container") || table.parentElement);
        if (container) return { mode: "before", el: container };

        return { mode: "body", el: document.body };
    }

    function insertAfterAnchor(element) {
        const anchor = getAnchor();

        if (anchor.mode === "after") anchor.el.insertAdjacentElement("afterend", element);
        else if (anchor.mode === "before") anchor.el.parentElement.insertBefore(element, anchor.el);
        else document.body.insertBefore(element, document.body.firstChild);
    }


    function gmGetJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: {
                    "Accept": "application/json, text/plain, */*"
                },
                onload: response => {
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (e) {
                        reject(new Error("JSON parse failed: " + e.message + " | status " + response.status));
                    }
                },
                onerror: error => reject(error)
            });
        });
    }

    function flattenPanels(panels, out = []) {
        (panels || []).forEach(panel => {
            if (panel.panels) {
                flattenPanels(panel.panels, out);
            } else {
                out.push(panel);
            }
        });
        return out;
    }

    async function runGrafanaDiagnostics() {
        const diag = {
            ranAt: new Date().toLocaleString(),
            ranAtMs: Date.now(),
            ok: false,
            dashboardUid: "YIQVoijMk",
            dashboardTitle: "",
            panelCount: 0,
            laneWatchPanels: [],
            error: "",
            location: location.href
        };

        try {
            const data = await gmGetJson("https://grafana-prod.prod.us-east-1.grafana.insights.aft.amazon.dev/api/dashboards/uid/YIQVoijMk");
            const dashboard = data.dashboard || {};
            const panels = flattenPanels(dashboard.panels || []);

            diag.ok = true;
            diag.dashboardTitle = dashboard.title || "";
            diag.panelCount = panels.length;
            diag.laneWatchPanels = panels
                .filter(panel => {
                    const title = lower(panel.title || "");
                    return title.includes("lane full") ||
                           title.includes("lane unavailable") ||
                           title.includes("failed to divert") ||
                           title.includes("recirc");
                })
                .map(panel => ({
                    id: panel.id,
                    title: panel.title || "",
                    type: panel.type || "",
                    datasource: panel.datasource || null,
                    targetCount: Array.isArray(panel.targets) ? panel.targets.length : 0,
                    targets: (panel.targets || []).map(target => ({
                        refId: target.refId,
                        datasource: target.datasource || panel.datasource || null,
                        queryType: target.queryType || "",
                        rawSql: target.rawSql || "",
                        expr: target.expr || "",
                        streamReference: target.streamReference || ""
                    }))
                }));

            GM_setValue(CONFIG.storage.grafanaDiag, diag);
            return diag;
        } catch (e) {
            diag.error = String(e && e.message ? e.message : e);
            GM_setValue(CONFIG.storage.grafanaDiag, diag);
            return diag;
        }
    }

    function getGrafanaDiagnostics() {
        try {
            return GM_getValue(CONFIG.storage.grafanaDiag, null);
        } catch (e) {
            return null;
        }
    }


    // ---------- Grafana capture ----------

    function laneLike(value) {
        const text = norm(value).toUpperCase();
        return /^S\d{5,6}$/.test(text) ||
               /^SR-?\d{3,5}[A-Z-]*$/.test(text) ||
               /^FR-?\d{3,5}[A-Z-]*$/.test(text) ||
               /^DD-?\d{2,5}[A-Z-]*$/.test(text) ||
               /^RECIRC$/.test(text);
    }

    function dedupeAndSort(items) {
        const map = new Map();
        items.forEach(item => {
            if (!item.lane || !Number.isFinite(item.count)) return;
            const old = map.get(item.lane);
            if (!old || item.count > old.count) map.set(item.lane, item);
        });
        return Array.from(map.values()).sort((a, b) => b.count - a.count);
    }

    function parseLaneCountsFromText(text) {
        const cleaned = String(text || "").replace(/\s+/g, " ");
        const out = [];

        const regex = /\b((?:S\d{5,6})|(?:SR-?\d{3,5}[A-Z-]*)|(?:FR-?\d{3,5}[A-Z-]*)|(?:DD-?\d{2,5}[A-Z-]*)|RECIRC)\b[\s:,-]*(\d{1,5})\b/gi;

        let match;
        while ((match = regex.exec(cleaned)) !== null) {
            const lane = norm(match[1]).toUpperCase();
            const count = Number(match[2]);

            if (laneLike(lane) && Number.isFinite(count)) {
                out.push({ lane, count });
            }
        }

        // Fallback for Grafana layouts where lane and count are separated into
        // adjacent text nodes/lines.
        const lines = String(text || "").split(/\n+/).map(norm).filter(Boolean);
        for (let i = 0; i < lines.length - 1; i++) {
            const lane = lines[i].toUpperCase();
            const count = Number(lines[i + 1]);

            if (laneLike(lane) && Number.isFinite(count)) {
                out.push({ lane, count });
            }
        }

        return dedupeAndSort(out);
    }

    function parseGrafanaSection(text, keywords) {
        const lines = text.split(/\n+/).map(norm).filter(Boolean);
        const start = lines.findIndex(line => keywords.every(k => lower(line).includes(k)));

        if (start < 0) {
            return [];
        }

        const chunk = lines.slice(start, Math.min(lines.length, start + 140)).join("\n");
        return parseLaneCountsFromText(chunk);
    }

    function getGrafanaPanelElements() {
        const selectors = [
            "[data-panelid]",
            "[class*='panel-container']",
            "[class*='panel-content']",
            "[class*='react-grid-item']",
            "[aria-label*='Panel']"
        ];

        const elements = Array.from(document.querySelectorAll(selectors.join(",")));

        // Keep bigger text containers only.
        return elements.filter(el => {
            const text = norm(el.innerText || el.textContent || "");
            return text.length > 20;
        });
    }

    function scrapeGrafanaFromPanels() {
        const panels = getGrafanaPanelElements();

        const result = {
            laneFull: [],
            laneUnavailable: [],
            failedToDivert: []
        };

        panels.forEach(panel => {
            const text = panel.innerText || panel.textContent || "";
            const ltext = lower(text);
            const items = parseLaneCountsFromText(text);

            if (!items.length) return;

            if (ltext.includes("lane full")) {
                result.laneFull = result.laneFull.concat(items);
            }

            if (ltext.includes("lane unavailable") || ltext.includes("disabled")) {
                result.laneUnavailable = result.laneUnavailable.concat(items);
            }

            if (ltext.includes("failed to divert") || ltext.includes("mhe recirc")) {
                result.failedToDivert = result.failedToDivert.concat(items);
            }
        });

        return {
            laneFull: dedupeAndSort(result.laneFull),
            laneUnavailable: dedupeAndSort(result.laneUnavailable),
            failedToDivert: dedupeAndSort(result.failedToDivert)
        };
    }

    function showGrafanaBadge(message) {
        let badge = document.getElementById(CONFIG.ids.grafanaBadge);
        if (!badge) {
            badge = document.createElement("div");
            badge.id = CONFIG.ids.grafanaBadge;
            document.body.appendChild(badge);
        }
        badge.textContent = `FCV Pro: ${message}`;
    }

    async function scrapeGrafanaLaneWatch() {
        const diag = await runGrafanaDiagnostics();
        const text = document.body ? document.body.innerText : "";
        const panelData = scrapeGrafanaFromPanels();

        let laneFull = panelData.laneFull;
        let laneUnavailable = panelData.laneUnavailable;
        let failedToDivert = panelData.failedToDivert;

        // Fallback to body text if panel-specific parsing misses.
        if (!laneFull.length) laneFull = parseGrafanaSection(text, ["lane", "full"]);
        if (!laneUnavailable.length) laneUnavailable = parseGrafanaSection(text, ["lane", "unavailable"]);
        if (!failedToDivert.length) failedToDivert = parseGrafanaSection(text, ["failed", "divert"]);

        // Last resort: if Grafana gives us lane/count text but not the panel titles
        // in the same DOM containers, place the generic list in Lane Full so at
        // least the data becomes visible in Foresight.
        const generic = parseLaneCountsFromText(text);
        if (!laneFull.length && !laneUnavailable.length && !failedToDivert.length && generic.length) {
            laneFull = generic;
        }

        const cache = {
            source: "grafana",
            building: getBuildingFromUrl(),
            sorter: getSorterFromUrl(),
            capturedAt: new Date().toLocaleString(),
            capturedAtMs: Date.now(),
            laneFull: dedupeAndSort(laneFull),
            laneUnavailable: dedupeAndSort(laneUnavailable),
            failedToDivert: dedupeAndSort(failedToDivert),
            url: location.href,
            signature: BUILD.signature,
            debug: {
                panelCount: getGrafanaPanelElements().length,
                genericCount: generic.length,
                bodyTextLength: text.length
            }
        };

        const total = cache.laneFull.length + cache.laneUnavailable.length + cache.failedToDivert.length;

        if (total) {
            GM_setValue(CONFIG.storage.grafana, cache);
            showGrafanaBadge(`Lane Watch cached: ${total} lanes`);
            console.debug("[FCV Pro] Grafana cached", cache);
        } else {
            showGrafanaBadge(`No lane values. API ${diag.ok ? "OK" : "FAIL"} • panels ${diag.panelCount || 0} • watch panels ${(diag.laneWatchPanels || []).length}`);
            console.debug("[FCV Pro] Grafana scrape found no data", cache, diag);
        }
    }

    function getCachedGrafana() {
        try {
            return GM_getValue(CONFIG.storage.grafana, null);
        } catch (e) {
            return null;
        }
    }

    // ---------- Foresight table helpers ----------

    function getHeaderMap(table) {
        const ths = Array.from(table.querySelectorAll("thead th"));
        if (!ths.length) return null;

        const map = {};
        const headers = ths.map(th => norm(th.textContent));

        ths.forEach((th, index) => {
            const text = lower(th.textContent);
            if (text.includes("chute")) map.chute = index;
            if (text.includes("stacking filter")) map.stackingFilter = index;
            if (text.includes("resources")) map.resources = index;
            if (text.includes("slam received")) map.slamReceived = index;
            if (text.includes("next cpt")) map.nextCpt = index;
        });

        if (!Number.isInteger(map.chute) ||
            !Number.isInteger(map.stackingFilter) ||
            !Number.isInteger(map.resources) ||
            !Number.isInteger(map.slamReceived)) {
            return null;
        }

        if (!Number.isInteger(map.nextCpt)) map.nextCpt = ths.length - 1;
        map.headers = headers;
        return map;
    }

    function getMainTable() {
        return Array.from(document.querySelectorAll("table"))
            .filter(table =>
                !table.closest(`#${CONFIG.ids.allTable}`) &&
                !table.closest(`#${CONFIG.ids.topRecirc}`) &&
                !table.closest(`#${CONFIG.ids.allocations}`) &&
                !table.closest(`#${CONFIG.ids.grafana}`)
            )
            .find(table => !!getHeaderMap(table)) || null;
    }

    function getFamilyFromText(chuteText, resourceText) {
        const combined = `${resourceText || ""} ${chuteText || ""}`.toUpperCase();

        if (combined.includes("SR-")) return { key: "SR", label: "Spirals", color: CHUTE_COLORS.SR };
        if (combined.includes("FR-0")) return { key: "FR0", label: "High Velocity", color: CHUTE_COLORS.FR0 };
        if (combined.includes("FR-1")) return { key: "FR1", label: "Flats", color: CHUTE_COLORS.FR1 };
        if (combined.includes("FR-2")) return { key: "FR2", label: "High Velocity 2.0", color: CHUTE_COLORS.FR2 };
        if (combined.includes("DD")) return { key: "DD", label: "Fluids", color: CHUTE_COLORS.DD };

        return { key: "UNKNOWN", label: "Unknown", color: "" };
    }

    function getRecircFromText(text) {
        // Only count the value inside parentheses from the
        // "SLAM received (Recirc)" column.
        //
        // Example:
        // "9 (8)"  -> 8
        // "1"      -> 0
        // "-"      -> 0
        //
        // This prevents the normal SLAM received count from being treated as recirc.
        const t = norm(text);
        const paren = t.match(/\((\d+)\)/);
        return paren ? Number(paren[1]) : 0;
    }

    function unavailableText(text) {
        const t = lower(text);
        return t.includes("unavailable") || t.includes("not available") || t.includes("not_in_use") || t.includes("not in use");
    }

    function statusFor(disabled, unavailable, recircValue) {
        if (disabled) return { key: "DISABLED", color: STATUS_COLORS.disabled, tooltip: "Disabled: blank stacking filter" };
        if (recircValue >= CONFIG.recircThreshold) return { key: "RECIRC", color: STATUS_COLORS.recirc, tooltip: `High Recirc: ${recircValue}` };
        if (unavailable) return { key: "UNAVAILABLE", color: STATUS_COLORS.unavailable, tooltip: "Unavailable" };
        return { key: "AVAILABLE", color: STATUS_COLORS.available, tooltip: "Available" };
    }

    function laneLabel(chuteText, resourceText) {
        if (resourceText && !isBlankOrDash(resourceText)) return resourceText;
        if (chuteText && !isBlankOrDash(chuteText)) return chuteText;
        return "Unknown lane";
    }

    function extractCurrentRows() {
        const table = getMainTable();
        if (!table) return { headers: STATE.headers, rows: [] };

        const map = getHeaderMap(table);
        if (!map) return { headers: STATE.headers, rows: [] };

        STATE.headers = map.headers;

        const rows = Array.from(table.querySelectorAll("tbody tr"));
        const extracted = [];

        rows.forEach(row => {
            if (!row.children || row.children.length <= map.slamReceived) return;

            const cells = Array.from(row.children).map(cell => norm(cell.textContent));
            const chuteText = cells[map.chute] || "";
            const stackingFilterText = cells[map.stackingFilter] || "";
            const resourceText = cells[map.resources] || "";
            const recircText = cells[map.slamReceived] || "";

            const disabled = isBlankOrDash(stackingFilterText);
            const recircValue = getRecircFromText(recircText);
            const unavailable = unavailableText(cells.join(" "));
            const family = getFamilyFromText(chuteText, resourceText);
            const label = laneLabel(chuteText, resourceText);
            const status = statusFor(disabled, unavailable, recircValue);

            if (label === "Unknown lane") return;

            extracted.push({
                cells,
                chuteText,
                stackingFilterText,
                resourceText,
                recircValue,
                unavailable,
                disabled,
                family,
                laneLabel: label,
                status
            });
        });

        return { headers: map.headers, rows: extracted, map };
    }


    function findBestHeaderMapFromDocument() {
        const tables = Array.from(document.querySelectorAll("table"));
        let best = null;

        for (const table of tables) {
            const map = getHeaderMap(table);
            if (map && (!best || (map.headers || []).length > (best.headers || []).length)) {
                best = map;
            }
        }

        return best;
    }

    function extractAllForesightRowsFromDOM() {
        const map = findBestHeaderMapFromDocument();
        if (!map) return { headers: STATE.headers, rows: [] };

        STATE.headers = map.headers || STATE.headers;

        const rows = [];
        const seen = new Set();
        const allRows = Array.from(document.querySelectorAll("table tbody tr, [role='row']"));

        allRows.forEach(row => {
            if (row.closest && row.closest("[id^='fcv-pro-']")) return;

            const cellElements = Array.from(row.querySelectorAll("td, [role='cell']"));
            if (!cellElements.length) return;

            const cells = cellElements.map(cell => norm(cell.textContent));
            if (cells.length <= Math.max(map.chute, map.stackingFilter, map.resources, map.slamReceived)) return;

            const chuteText = cells[map.chute] || "";
            const stackingFilterText = cells[map.stackingFilter] || "";
            const resourceText = cells[map.resources] || "";
            const recircText = cells[map.slamReceived] || "";

            if (!chuteText && !resourceText && !stackingFilterText) return;

            const family = getFamilyFromText(chuteText, resourceText);
            if (family.key === "UNKNOWN") return;

            const label = laneLabel(chuteText, resourceText);
            if (label === "Unknown lane") return;

            const key = `${label}|${chuteText}|${stackingFilterText}|${recircText}`;
            if (seen.has(key)) return;
            seen.add(key);

            const disabled = isBlankOrDash(stackingFilterText);
            const recircValue = getRecircFromText(recircText);
            const unavailable = unavailableText(cells.join(" "));
            const status = statusFor(disabled, unavailable, recircValue);

            rows.push({
                cells,
                chuteText,
                stackingFilterText,
                resourceText,
                recircValue,
                unavailable,
                disabled,
                family,
                laneLabel: label,
                status
            });
        });

        return { headers: map.headers, rows, map };
    }

    function refreshFullDomLaneCache() {
        return refreshRealForesightLaneCache();
    }



    function getRealForesightTables() {
        return Array.from(document.querySelectorAll(".awsui-table-container table, [class*='awsui-table-container'] table, table"))
            .filter(table => {
                if (!table || (table.closest && table.closest("[id^='fcv-pro-']"))) return false;
                if (!getHeaderMap(table)) return false;
                return true;
            });
    }

    function getPrimaryForesightTable() {
        const tables = getRealForesightTables();
        if (!tables.length) return null;

        return tables
            .map(table => ({
                table,
                rows: table.querySelectorAll("tbody tr.awsui-table-row, tbody tr").length,
                headers: table.querySelectorAll("thead th, [role='columnheader']").length
            }))
            .sort((a, b) => (b.rows - a.rows) || (b.headers - a.headers))[0].table;
    }

    function getRealForesightHeaderMap() {
        const table = getPrimaryForesightTable();
        return table ? getHeaderMap(table) : null;
    }

    function getRealForesightRows() {
        const table = getPrimaryForesightTable();
        if (!table) return [];

        return Array.from(table.querySelectorAll("tbody tr.awsui-table-row, tbody tr"))
            .filter(row => !(row.closest && row.closest("[id^='fcv-pro-']")))
            .filter(row => !row.querySelector(".fcv-pro-chute-zone"))
            .filter(row => Array.from(row.querySelectorAll("td, [role='cell']")).length > 0);
    }

    function normalizeLaneDedupeKey(row) {
        return norm(row.laneLabel || row.resourceText || row.chuteText || "").toUpperCase();
    }

    function dedupeLaneRowsByHighestRecirc(rows) {
        const map = new Map();

        (rows || []).forEach(row => {
            const key = normalizeLaneDedupeKey(row);
            if (!key) return;

            const previous = map.get(key);

            if (!previous || Number(row.recircValue || 0) > Number(previous.recircValue || 0)) {
                map.set(key, row);
            }
        });

        return Array.from(map.values());
    }

    function findRecircSortHeader() {
        const table = getPrimaryForesightTable();
        if (!table) return null;

        return Array.from(table.querySelectorAll("thead th, [role='columnheader'], th button, [role='button']"))
            .find(el => {
                const text = norm(el.textContent || "");
                return text.includes("SLAM received") && text.includes("Recirc");
            }) || null;
    }

    function isHeaderSortedDescending(header) {
        if (!header) return false;

        const candidates = [
            header,
            header.closest("th"),
            header.closest("[role='columnheader']")
        ].filter(Boolean);

        return candidates.some(el =>
            String(el.getAttribute("aria-sort") || "").toLowerCase() === "descending" ||
            String(el.getAttribute("data-sort-direction") || "").toLowerCase() === "descending" ||
            String(el.getAttribute("aria-label") || "").toLowerCase().includes("descending")
        );
    }

    async function autoSortRecircDescending(force = false) {
        const now = Date.now();

        if (!force && now - (STATE.lastAutoRecircSortMs || 0) < 120000) return;
        STATE.lastAutoRecircSortMs = now;

        const header = findRecircSortHeader();
        if (!header) return;

        const clickable =
            header.closest("button") ||
            header.querySelector("button") ||
            header.closest("th") ||
            header;

        if (!isHeaderSortedDescending(header)) {
            clickable.click();
            await sleep(700);
        }

        const updatedHeader = findRecircSortHeader();

        if (!isHeaderSortedDescending(updatedHeader)) {
            const clickable2 =
                updatedHeader?.closest("button") ||
                updatedHeader?.querySelector?.("button") ||
                updatedHeader?.closest?.("th") ||
                updatedHeader;

            if (clickable2) {
                clickable2.click();
                await sleep(900);
            }
        }

        refreshRealForesightLaneCache();
    }

    function extractRealForesightRows() {
        const table = getPrimaryForesightTable();
        const map = table ? getHeaderMap(table) : null;

        if (!table || !map) return { headers: STATE.headers, rows: [] };

        STATE.headers = map.headers || STATE.headers;

        const extracted = [];

        getRealForesightRows().forEach(row => {
            const cells = Array.from(row.querySelectorAll("td, [role='cell']")).map(cell => norm(cell.textContent));
            if (cells.length <= Math.max(map.chute, map.stackingFilter, map.resources, map.slamReceived)) return;

            const chuteText = cells[map.chute] || "";
            const stackingFilterText = cells[map.stackingFilter] || "";
            const resourceText = cells[map.resources] || "";
            const recircText = cells[map.slamReceived] || "";

            const family = getFamilyFromText(chuteText, resourceText);
            if (family.key === "UNKNOWN") return;

            const label = laneLabel(chuteText, resourceText);
            if (label === "Unknown lane") return;

            const disabled = isBlankOrDash(stackingFilterText);
            const recircValue = getRecircFromText(recircText);
            const unavailable = unavailableText(cells.join(" "));
            const status = statusFor(disabled, unavailable, recircValue);

            extracted.push({
                cells,
                chuteText,
                stackingFilterText,
                resourceText,
                recircValue,
                unavailable,
                disabled,
                family,
                laneLabel: label,
                status
            });
        });

        return {
            headers: map.headers,
            rows: dedupeLaneRowsByHighestRecirc(extracted),
            map
        };
    }

    function refreshRealForesightLaneCache() {
        const real = extractRealForesightRows();
        if (real.rows && real.rows.length) addRowsToCache(real.rows);
        return real;
    }


    function rowKey(row) {
        return `${row.laneLabel}|${row.chuteText}|${row.stackingFilterText}`;
    }

    function addRowsToCache(rows) {
        rows.forEach(row => STATE.laneCache.set(rowKey(row), row));
    }

    function getCachedRows() {
        const current = extractCurrentRows();
        addRowsToCache(current.rows);
        return {
            headers: STATE.headers.length ? STATE.headers : current.headers,
            rows: Array.from(STATE.laneCache.values())
        };
    }

    function filterPass(familyKey, disabled, recircValue) {
        // Legend filters were removed in v18. Keep all rows visible.
        return true;
    }

    // ---------- Allocations ----------

    function shortAllocationStatus(statusText) {
        const status = norm(statusText);
        const lowered = lower(statusText);

        if (lowered.includes("pending") && lowered.includes("container") && lowered.includes("open")) return "Pending Open";
        if (lowered.includes("container") && lowered.includes("open")) return "Pending Open";
        if (lowered.includes("completed") || lowered.includes("complete")) return "Completed";
        if (lowered.includes("allocated")) return "Allocated";
        if (lowered.includes("cancelled") || lowered.includes("canceled")) return "Cancelled";
        if (lowered.includes("failed") || lowered.includes("error")) return "Failed";

        return status;
    }

    function getStatusColor(statusText) {
        const status = lower(statusText);

        // Allocation page-style color logic:
        // green = done/allocated, yellow = pending, orange = open/in-progress,
        // red = cancelled/failed/problem.
        if (status.includes("completed") || status.includes("complete")) return "#22C55E";
        if (status.includes("pending") && status.includes("container") && status.includes("open")) return "#FACC15";
        if (status.includes("pending")) return "#FACC15";
        if (status.includes("allocated") && status.includes("container") && status.includes("open")) return "#FACC15";
        if (status.includes("allocated")) return "#22C55E";
        if (status.includes("container") && status.includes("open")) return "#FACC15";
        if (status.includes("executing") || status.includes("in progress")) return "#F59E0B";
        if (status.includes("cancelled") || status.includes("canceled")) return "#D13212";
        if (status.includes("failed") || status.includes("error")) return "#D13212";

        return "#E5E5E5";
    }

    function allocationHeaderMap(table) {
        const headers = Array.from(table.querySelectorAll("thead th"));
        if (!headers.length) return null;

        const map = {};
        headers.forEach((header, index) => {
            const text = lower(header.textContent);

            if (text.includes("stacking filter")) map.stackingFilter = index;
            if (text.includes("proposed allocation")) map.proposedAllocation = index;
            if (text.includes("current allocation")) map.currentAllocation = index;
            if (text === "status" || text.includes("status")) map.status = index;
        });

        if (!Number.isInteger(map.stackingFilter) || !Number.isInteger(map.status)) return null;

        if (!Number.isInteger(map.proposedAllocation)) {
            // Fallback for the Auto Recommendations table in case AWSUI text wrapping
            // causes header detection to fail.
            map.proposedAllocation = 9;
        }

        return map;
    }

    function chuteFromProposed(text) {
        const proposed = norm(text);
        const patterns = [/\bSR-\d{3,5}-?[A-Z]?\b/i, /\bFR-\d{3,5}\b/i, /\bDD-?\d{2,5}\b/i, /\bDD\d{2,5}\b/i];
        for (const pattern of patterns) {
            const match = proposed.match(pattern);
            if (match) return match[0].toUpperCase();
        }
        return proposed || "Unknown chute";
    }

    function allocationFamilyFromChute(chute) {
        const text = norm(chute).toUpperCase();

        if (text.includes("SR-")) return { key: "SR", order: 1, color: CHUTE_COLORS.SR, label: "Spirals" };
        if (text.includes("FR-1")) return { key: "FR1", order: 2, color: CHUTE_COLORS.FR1, label: "Flats" };
        if (text.includes("FR-0")) return { key: "FR0", order: 3, color: CHUTE_COLORS.FR0, label: "High Velocity" };
        if (text.includes("FR-2")) return { key: "FR2", order: 4, color: CHUTE_COLORS.FR2, label: "High Velocity 2.0" };
        if (text.includes("DD")) return { key: "DD", order: 5, color: CHUTE_COLORS.DD, label: "Fluids" };

        return { key: "UNKNOWN", order: 99, color: "#E5E5E5", label: "Unknown" };
    }

    function extractAllocationMetaFromDocument(doc = document) {
        const text = doc.body ? doc.body.innerText : "";

        const nextMatch = text.match(/Next automatic recommendations in\s*([0-9]{1,2}:[0-9]{2})/i);
        const lastMatch = text.match(/Last recommendations generated at\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[A-Z]{2,4})/i);

        return {
            nextAutomaticRecommendation: nextMatch ? cleanAllocationTimerText(nextMatch[1]) : "",
            lastRecommendationsGeneratedAt: lastMatch ? cleanLastGeneratedText(lastMatch[1]) : "",
            capturedAt: new Date().toLocaleString(),
            capturedAtMs: Date.now()
        };
    }

    function extractAllocationMetaFromPage() {
        return extractAllocationMetaFromDocument(document);
    }

    function extractAllocationsFromDocument(doc = document) {
        const tables = Array.from(doc.querySelectorAll("table"));
        const allocations = [];

        tables.forEach(table => {
            const map = allocationHeaderMap(table);
            if (!map) return;

            Array.from(table.querySelectorAll("tbody tr")).forEach(row => {
                const cells = Array.from(row.children).map(cell => norm(cell.textContent));
                if (cells.length <= Math.max(map.stackingFilter, map.proposedAllocation, map.status)) return;

                const stackingFilter = cells[map.stackingFilter] || "";
                let proposedAllocation = cells[map.proposedAllocation] || "";
                let status = cells[map.status] || "";

                if (!proposedAllocation) {
                    proposedAllocation = cells.find(c =>
                        /\b(add|remove|check)\b/i.test(c) &&
                        /\b(SR-|FR-|DD)/i.test(c)
                    ) || "";
                }

                if (!status) {
                    status = cells.find(c =>
                        /completed|pending|allocated|container open|container close|cancelled|canceled|failed|executing|in progress|check for missorts/i.test(c)
                    ) || "";
                }

                if (!stackingFilter || !proposedAllocation || !status) return;
                if (lower(stackingFilter).includes("dependent recommendation")) return;

                const chute = chuteFromProposed(proposedAllocation);
                const family = allocationFamilyFromChute(chute);

                allocations.push({
                    stackingFilter,
                    chute,
                    proposedAllocation,
                    status,
                    statusColor: getStatusColor(status),
                    family,
                    capturedAt: new Date().toLocaleString()
                });
            });
        });

        allocations.sort((a, b) => {
            const fa = a.family || allocationFamilyFromChute(a.chute);
            const fb = b.family || allocationFamilyFromChute(b.chute);
            if (fa.order !== fb.order) return fa.order - fb.order;
            return String(a.chute).localeCompare(String(b.chute));
        });

        const meta = extractAllocationMetaFromDocument(doc);

        if (allocations.length || meta.nextAutomaticRecommendation || meta.lastRecommendationsGeneratedAt) {
            GM_setValue(CONFIG.storage.allocations, {
                meta,
                items: allocations
            });
        }

        return { meta, items: allocations };
    }

    function extractAllocationsFromPage() {
        const result = extractAllocationsFromDocument(document);
        return result.items;
    }

    function getCachedAllocations() {
        if (isAllocationPage()) {
            const current = extractAllocationsFromDocument(document);
            if ((current.items || []).length || current.meta.nextAutomaticRecommendation || current.meta.lastRecommendationsGeneratedAt) {
                return current;
            }
        }

        try {
            const cached = GM_getValue(CONFIG.storage.allocations, { meta: {}, items: [] });
            if (Array.isArray(cached)) return { meta: {}, items: cached };
            return cached || { meta: {}, items: [] };
        } catch (e) {
            return { meta: {}, items: [] };
        }
    }

    function getAllocationUrl() {
        const building = getBuildingFromUrl();
        return `https://sort.aka.amazon.com/foresight/${building}/CrossBeltSorterAutoRecommendations`;
    }

    function refreshAllocationsHiddenFrame() {
        if (isAllocationPage()) {
            extractAllocationsFromDocument(document);
            return;
        }

        let frame = document.getElementById(CONFIG.ids.allocationFrame);
        if (!frame) {
            frame = document.createElement("iframe");
            frame.id = CONFIG.ids.allocationFrame;
            document.body.appendChild(frame);

            frame.addEventListener("load", () => {
                try {
                    const doc = frame.contentDocument || frame.contentWindow.document;
                    extractAllocationsFromDocument(doc);
                    renderAll();
                } catch (e) {
                    console.debug("[FCV Pro] Hidden allocation frame scrape failed", e);
                }
            });
        }

        frame.src = getAllocationUrl() + `?fcvRefresh=${Date.now()}`;
    }


    function cleanAllocationTimerText(value) {
        const text = norm(value);
        const match = text.match(/[0-9]{1,2}:[0-9]{2}/);
        return match ? match[0] : "";
    }

    function cleanLastGeneratedText(value) {
        const text = norm(value);
        const match = text.match(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+[A-Z]{2,4}/);
        return match ? match[0] : "";
    }

    function secondsUntilNextFiveMinuteReset() {
        const now = new Date();
        const seconds = now.getSeconds();
        const minutes = now.getMinutes();
        const nextMinute = Math.ceil((minutes + (seconds > 0 ? 1 : 0)) / 5) * 5;
        const next = new Date(now);

        if (nextMinute >= 60) {
            next.setHours(now.getHours() + 1, 0, 0, 0);
        } else {
            next.setMinutes(nextMinute, 0, 0);
            if (next <= now) next.setMinutes(next.getMinutes() + 5);
        }

        return Math.max(0, Math.round((next - now) / 1000));
    }

    function formatDuration(seconds) {
        const s = Math.max(0, Number(seconds) || 0);
        const m = Math.floor(s / 60);
        const r = String(s % 60).padStart(2, "0");
        return `${m}:${r}`;
    }

    function severityClass(value) {
        if (value >= CONFIG.severeRecircThreshold) return "fcv-pro-top-severe";
        if (value >= CONFIG.recircThreshold) return "fcv-pro-top-warning";
        return "fcv-pro-top-good";
    }


    // ---------- UI render ----------
    // ---------- UI render ----------

    function ensureControlBar() {
        let bar = document.getElementById(CONFIG.ids.control);
        if (bar) return bar;

        bar = document.createElement("div");
        bar.id = CONFIG.ids.control;
        insertAfterAnchor(bar);
        return bar;
    }


    function hideEverything() {
        STATE.collapsed = true;
        STATE.hidden = false;
        savePrefs();
        renderAll();
    }

    function showEverything() {
        STATE.hidden = false;
        savePrefs();
        renderAll();
    }

    function ensureShowTab() {
        let tab = document.getElementById("fcv-pro-show-tab");

        if (tab) tab.remove();
        return;

        if (!tab) {
            tab = document.createElement("button");
            tab.id = "fcv-pro-show-tab";
            tab.textContent = "Show FCV Pro";
            document.body.appendChild(tab);
            tab.addEventListener("click", showEverything);
        }
    }

    function toggleMasterCollapse() {
        STATE.collapsed = !STATE.collapsed;
        savePrefs();
        renderAll();
    }

    function cleanFloatingForesightStickyElements() {
        document.querySelectorAll(".awsui-table-header-copy").forEach(el => {
            el.style.setProperty("display", "none", "important");
            el.style.setProperty("visibility", "hidden", "important");
            el.style.setProperty("pointer-events", "none", "important");
        });

        document.documentElement.style.overflowY = "auto";
        document.body.style.overflowY = "auto";
    }


    function updateToolbarOffset() {
        const bar = document.getElementById(CONFIG.ids.control);
        if (!bar) return;

        const height = Math.ceil(bar.getBoundingClientRect().height || 44);
        const offset = Math.max(50, height + 10);

        document.documentElement.style.setProperty("--fcv-pro-toolbar-height", `${offset}px`);
        document.body.classList.add("fcv-pro-has-fixed-bar");
        document.body.style.paddingTop = `${offset}px`;
    }

    function getAwsuiPageButtons() {
        const buttons = Array.from(document.querySelectorAll(
            'awsui-table-pagination button[aria-label^="Page Number"], button[aria-label^="Page Number"]'
        ));

        return buttons
            .map(button => {
                const aria = button.getAttribute("aria-label") || "";
                const match = aria.match(/Page Number\s+(\d+)/i);
                return match ? { button, page: Number(match[1]) } : null;
            })
            .filter(Boolean)
            .filter(item => Number.isFinite(item.page))
            .sort((a, b) => a.page - b.page);
    }

    function getCurrentAwsuiPageNumber() {
        const selected = Array.from(document.querySelectorAll(
            'awsui-table-pagination button[aria-current="page"], awsui-table-pagination button[aria-selected="true"], button[aria-current="page"], button[aria-selected="true"]'
        ))[0];

        if (selected) {
            const label = selected.getAttribute("aria-label") || selected.textContent || "";
            const match = label.match(/(\d+)/);
            if (match) return Number(match[1]);
        }

        const active = getAwsuiPageButtons().find(item => {
            const button = item.button;
            return button.className.includes("current") ||
                   button.className.includes("selected") ||
                   button.getAttribute("aria-current") === "page" ||
                   button.getAttribute("aria-selected") === "true";
        });

        return active ? active.page : null;
    }

    async function harvestAllPaginationPagesForTopRecirc(force = false) {
        if (STATE.scanRunning) return;

        const now = Date.now();
        if (!force && now - (STATE.lastPageHarvestMs || 0) < 90000) return;
        STATE.lastPageHarvestMs = now;

        const buttons = getAwsuiPageButtons();

        if (!buttons.length) {
            refreshRealForesightLaneCache();
            return;
        }

        const originalPage = getCurrentAwsuiPageNumber();
        const seen = new Set();

        STATE.scanRunning = true;

        try {
            refreshRealForesightLaneCache();

            for (const item of buttons) {
                if (seen.has(item.page)) continue;
                seen.add(item.page);

                item.button.click();
                await sleep(CONFIG.scanDelayMs || 650);
                refreshRealForesightLaneCache();
            }

            if (originalPage !== null) {
                const returnButton = getAwsuiPageButtons().find(item => item.page === originalPage);
                if (returnButton) {
                    returnButton.button.click();
                    await sleep(CONFIG.scanDelayMs || 650);
                    refreshRealForesightLaneCache();
                }
            }
        } finally {
            STATE.scanRunning = false;
        }
    }

    async function silentScanAllPagesForTopRecirc() {
        await harvestAllPaginationPagesForTopRecirc(false);
    }


    function renderControlBar() {
        const bar = ensureControlBar();
        STATE.hidden = false;
        STATE.panels.allTable = false;
        STATE.panels.legend = false;
        bar.classList.toggle("fcv-pro-collapsed", STATE.collapsed);

        bar.innerHTML = `
            <div class="fp-toolbar-row fp-toolbar-main">
                <span class="fp-toolbar-left">
                    <button id="fcv-pro-collapse-toggle">${STATE.collapsed ? "Expand All" : "Collapse All"}</button>
                    <span id="fcv-pro-version-label">Foresight Plus v${escapeHtml(BUILD.version)}</span>
                    <span class="fcv-pro-inline-legend">
                        <span><b style="background:#8E44AD"></b>Spirals</span>
                        <span><b style="background:#00A6D6"></b>Flats</span>
                        <span><b style="background:#E67E22"></b>HV</span>
                        <span><b style="background:#F1C40F"></b>HV 2.0</span>
                        <span><b style="background:#1F4E79"></b>Fluids</span>
                        <span><b style="background:#90EE90"></b>Available</span>
                        <span><b style="background:#66A3FF"></b>Recirc</span>
                        <span><b style="background:#A9A9A9"></b>Disabled</span>
                    </span>
                </span>
                <span class="fp-toolbar-right">
                    <button data-panel="grafana">Grafana</button>
                    <button data-panel="allocations">Allocations</button>
                    <button data-panel="topRecirc">Top Recirc</button>
                    <button data-panel="vast">VAST</button>
                </span>
            </div>
            <div class="fp-toolbar-row fp-toolbar-links">
                <span class="fp-group-label">Go to:</span>
                <button class="fp-link-btn" data-link="scarta">SCARTA</button>
                <button class="fp-link-btn" data-link="troubleshoot">Troubleshoot</button>
                <button class="fp-link-btn" data-link="stemContainerBuild">STEM</button>
                <button class="fp-link-btn" data-link="grafana">Grafana</button>
                <button class="fp-link-btn" data-link="vast">VAST</button>
                <span class="fp-group-spacer"></span>
                <button id="fcv-pro-refresh-grafana">Refresh Grafana</button>
                <button id="fcv-pro-refresh-allocations">Refresh Allocations</button>
                <button id="fp-refresh-stem">Refresh STEM</button>
                <button id="fp-refresh-vast">Refresh VAST</button>
            </div>
        `;

        const collapseToggle = document.getElementById("fcv-pro-collapse-toggle");
        if (collapseToggle) collapseToggle.addEventListener("click", toggleMasterCollapse);

        Array.from(bar.querySelectorAll("button[data-panel]")).forEach(button => {
            const key = button.dataset.panel;
            button.classList.toggle("fcv-pro-active", !!STATE.panels[key]);
            button.classList.toggle("fcv-pro-off", !STATE.panels[key]);
            button.addEventListener("click", () => {
                STATE.panels[key] = !STATE.panels[key];
                savePrefs();
                renderAll();
            });
        });

        Array.from(bar.querySelectorAll("button[data-link]")).forEach(button => {
            button.addEventListener("click", () => fpOpen(FP_URLS[button.dataset.link]));
        });

        const refreshGrafana = document.getElementById("fcv-pro-refresh-grafana");
        if (refreshGrafana) {
            refreshGrafana.addEventListener("click", async () => {
                refreshGrafana.textContent = "Refreshing...";
                refreshGrafana.disabled = true;
                try { if (typeof runGrafanaDiagnostics === "function") await runGrafanaDiagnostics(); renderAll(); }
                finally { refreshGrafana.textContent = "Refresh Grafana"; refreshGrafana.disabled = false; }
            });
        }

        const refreshAllocations = document.getElementById("fcv-pro-refresh-allocations");
        if (refreshAllocations) {
            refreshAllocations.addEventListener("click", () => {
                refreshAllocations.textContent = "Refreshing...";
                refreshAllocations.disabled = true;
                try {
                    if (typeof refreshAllocationsHiddenFrame === "function") refreshAllocationsHiddenFrame();
                    else extractAllocationsFromPage();
                } finally {
                    refreshAllocations.textContent = "Refresh Allocations";
                    refreshAllocations.disabled = false;
                    renderAll();
                }
            });
        }

        const refreshStem = document.getElementById("fp-refresh-stem");
        if (refreshStem) {
            refreshStem.addEventListener("click", async () => {
                refreshStem.textContent = "Refreshing...";
                refreshStem.disabled = true;
                try { await fpRefreshStemAssociates(); }
                finally { refreshStem.textContent = "Refresh STEM"; refreshStem.disabled = false; renderAll(); }
            });
        }

        const refreshVast = document.getElementById("fp-refresh-vast");
        if (refreshVast) {
            refreshVast.addEventListener("click", async () => {
                refreshVast.textContent = "Refreshing...";
                refreshVast.disabled = true;
                try { await fpRefreshVastAlerts(); }
                finally { refreshVast.textContent = "Refresh VAST"; refreshVast.disabled = false; renderAll(); }
            });
        }

        updateToolbarOffset();
    }


    function toggleFilter(filter) {
        if (filter === "ALL") {
            STATE.filters.recircOnly = false;
            STATE.filters.hideDisabled = false;
            STATE.filters.families.clear();
        } else if (filter === "RECIRC") {
            STATE.filters.recircOnly = !STATE.filters.recircOnly;
        } else if (filter === "HIDE_DISABLED") {
            STATE.filters.hideDisabled = !STATE.filters.hideDisabled;
        } else if (AREA_ORDER.includes(filter)) {
            if (STATE.filters.families.has(filter)) STATE.filters.families.delete(filter);
            else STATE.filters.families.add(filter);
        }

        renderAll();
    }

    function filterActive(filter) {
        if (filter === "ALL") return !STATE.filters.recircOnly && !STATE.filters.hideDisabled && STATE.filters.families.size === 0;
        if (filter === "RECIRC") return STATE.filters.recircOnly;
        if (filter === "HIDE_DISABLED") return STATE.filters.hideDisabled;
        if (AREA_ORDER.includes(filter)) return STATE.filters.families.has(filter);
        return false;
    }

    function renderLegend() {
        let legend = document.getElementById(CONFIG.ids.legend);
        if (!STATE.panels.legend) {
            if (legend) legend.remove();
            return;
        }

        if (!legend) {
            legend = document.createElement("div");
            legend.id = CONFIG.ids.legend;
            document.getElementById(CONFIG.ids.control).insertAdjacentElement("afterend", legend);
        }

        legend.innerHTML = `
            <span><b style="background:${CHUTE_COLORS.SR}"></b>Spirals</span>
            <span><b style="background:${CHUTE_COLORS.FR1}"></b>Flats</span>
            <span><b style="background:${CHUTE_COLORS.FR0}"></b>HV</span>
            <span><b style="background:${CHUTE_COLORS.FR2}"></b>HV 2.0</span>
            <span><b style="background:${CHUTE_COLORS.DD}"></b>Fluids</span>
            <span><b style="background:${STATUS_COLORS.available}"></b>Available</span>
            <span><b style="background:${STATUS_COLORS.recirc}"></b>Recirc 10+</span>
            <span><b style="background:${STATUS_COLORS.unavailable}"></b>Unavailable</span>
            <span><b style="background:${STATUS_COLORS.disabled}"></b>Disabled</span>

        `;


    }

    function panelAfterPrevious(id) {
        let existing = document.getElementById(id);
        if (existing) return existing;

        const panel = document.createElement("div");
        panel.id = id;
        panel.className = "fcv-pro-panel";

        const order = [CONFIG.ids.legend, CONFIG.ids.grafana, CONFIG.ids.allocations, CONFIG.ids.topRecirc, CONFIG.ids.allTable];
        const index = order.indexOf(id);
        let inserted = false;

        for (let i = index - 1; i >= 0; i--) {
            const prev = document.getElementById(order[i]);
            if (prev) {
                prev.insertAdjacentElement("afterend", panel);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            document.getElementById(CONFIG.ids.control).insertAdjacentElement("afterend", panel);
        }

        return panel;
    }

    function renderGrafanaPanel() {
        let panel = document.getElementById(CONFIG.ids.grafana);
        if (!STATE.panels.grafana) {
            if (panel) panel.remove();
            return;
        }

        panel = panelAfterPrevious(CONFIG.ids.grafana);

        const cache = getCachedGrafana();
        console.debug("[FCV Pro] Grafana cache", cache);
        if (!cache) {
            const diag = getGrafanaDiagnostics();
            const diagText = diag
                ? `API ${diag.ok ? "OK" : "FAIL"} • Panels ${diag.panelCount || 0} • Lane Watch Panels ${(diag.laneWatchPanels || []).length}${diag.error ? " • " + diag.error : ""}`
                : "No diagnostics yet.";

            panel.innerHTML = `
                <div class="fcv-pro-panel-title">Grafana Lane Watch</div>
                <div class="fcv-pro-panel-subtitle">No Grafana cache yet. ${escapeHtml(diagText)}</div>
                <div class="fcv-pro-actions">
                    <button id="fcv-pro-refresh-grafana-panel">Refresh Grafana</button>
                </div>
            `;

            document.getElementById("fcv-pro-refresh-grafana-panel")?.addEventListener("click", async () => {
                await runGrafanaDiagnostics();
                renderAll();
            });
            return;
        }

        const age = Math.max(0, Math.round((Date.now() - Number(cache.capturedAtMs || 0)) / 1000));
        const ageText = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;

        panel.innerHTML = `
            <div class="fcv-pro-panel-title fcv-pro-title-row">
                <span class="fcv-pro-title-main">Grafana Lane Watch</span>
                <span class="fcv-pro-title-pill">Updated ${escapeHtml(ageText)} • Resets in ${escapeHtml(formatDuration(secondsUntilNextFiveMinuteReset()))}</span>
            </div>
            <div class="fcv-pro-panel-subtitle"></div>
            <div class="fcv-pro-grid">
                ${renderGrafanaSection("Lane Full (Ops Recirc)", cache.laneFull)}
                ${renderGrafanaSection("Unavailable / Disabled (Ops Recirc)", cache.laneUnavailable)}
            </div>

        `;

    }

    function renderGrafanaSection(title, items) {
        const limited = (items || [])
            .filter(item => grafanaLaneShouldDisplay(item.lane))
            .slice(0, CONFIG.maxGrafanaItems);
        const html = limited.length
            ? limited.map(item => `
                <div class="fcv-pro-item ${countClass(item.count)}-row" title="${escapeHtml(grafanaDisplayName(item.lane))}: ${item.count}">
                    <span class="fcv-pro-item-name">${escapeHtml(grafanaDisplayName(item.lane))} ${fpAssociateBadge(grafanaDisplayName(item.lane))}</span>
                    <span class="fcv-pro-item-count ${countClass(item.count)}">${item.count}</span>
                </div>
            `).join("")
            : `<div class="fcv-pro-empty">No data</div>`;

        return `
            <div class="fcv-pro-card">
                <div class="fcv-pro-card-title">${escapeHtml(title)}</div>
                <div class="fcv-pro-list">${html}</div>
            </div>
        `;
    }

    function renderAllocationsPanel() {
        let panel = document.getElementById(CONFIG.ids.allocations);
        if (!STATE.panels.allocations) {
            if (panel) panel.remove();
            return;
        }

        panel = panelAfterPrevious(CONFIG.ids.allocations);
        const allocationCache = getCachedAllocations();
        const allocations = allocationCache.items || [];
        const meta = allocationCache.meta || {};

        const metaText = "";

        const grouped = { SR: [], FR1: [], FR0: [], FR2: [], DD: [] };
        allocations.forEach(item => {
            const family = item.family || allocationFamilyFromChute(item.chute);
            if (grouped[family.key]) grouped[family.key].push(item);
        });

        const header = CONFIG.allocationAreaOrder.map(key => `
            <th style="background:${CHUTE_COLORS[key]}; color:${colorText(CHUTE_COLORS[key])};">
                ${AREA_LABELS[key]}
            </th>
        `).join("");

        const body = CONFIG.allocationAreaOrder.map(key => {
            const items = grouped[key] || [];

            if (!items.length) {
                return `<td><div class="fcv-pro-allocation-empty-area">No allocations</div></td>`;
            }

            return `<td>${items.map(item => {
                const family = item.family || allocationFamilyFromChute(item.chute);
                const chuteColor = family.color || "#E5E5E5";
                const textColor = colorText(chuteColor);

                return `
                    <div class="fcv-pro-allocation-card">
                        <div class="fcv-pro-allocation-topline">
                            <span class="fcv-pro-allocation-chute" style="background:${chuteColor}; color:${textColor}" title="${escapeHtml(family.label)}">
                                ${escapeHtml(item.chute)}
                            </span>
                            <span class="fcv-pro-status-pill" style="background:${item.statusColor}">
                                ${escapeHtml(shortAllocationStatus(item.status))}
                            </span>
                        </div>
                        <div class="fcv-pro-subtext">${escapeHtml(item.proposedAllocation)}</div>
                    </div>
                `;
            }).join("")}</td>`;
        }).join("");

        const nextTimer = cleanAllocationTimerText(meta.nextAutomaticRecommendation || "");
        const lastGenerated = cleanLastGeneratedText(meta.lastRecommendationsGeneratedAt || "");
        const allocationPill = nextTimer
            ? `Next recommendation in ${nextTimer}`
            : "Next recommendation --";

        panel.innerHTML = `
            <div class="fcv-pro-panel-title fcv-pro-title-row">
                <span class="fcv-pro-title-main">Allocations</span>
                <span class="fcv-pro-title-meta">Generated ${escapeHtml(lastGenerated || "--")}</span>
                <span class="fcv-pro-title-pill">${escapeHtml(allocationPill)}</span>
            </div>
            <div class="fcv-pro-allocation-meta"></div>
            <table class="fcv-pro-allocation-area-table">
                <thead><tr>${header}</tr></thead>
                <tbody><tr>${body}</tr></tbody>
            </table>
        `;
    }


    function summary(row) {
        return {
            familyKey: row.family.key,
            familyLabel: row.family.label,
            laneLabel: row.laneLabel,
            recircValue: row.recircValue,
            disabled: row.disabled
        };
    }

    function renderTopRecircPanel(rows) {
        let panel = document.getElementById(CONFIG.ids.topRecirc);
        if (!STATE.panels.topRecirc) {
            if (panel) panel.remove();
            return;
        }

        panel = panelAfterPrevious(CONFIG.ids.topRecirc);

        const grouped = { SR: [], FR1: [], FR0: [], FR2: [], DD: [] };
        rows.map(summary).forEach(lane => {
            if (!lane || lane.disabled) return;
            if (!grouped[lane.familyKey]) return;
            if (lane.recircValue <= 0) return;
            grouped[lane.familyKey].push(lane);
        });

        const areaRow = AREA_ORDER.map(key => `<th style="background:${CHUTE_COLORS[key]};color:white">${AREA_LABELS[key]}</th>`).join("");
        const laneRow = AREA_ORDER.map(key => {
            const top = grouped[key].sort((a, b) => b.recircValue - a.recircValue).slice(0, CONFIG.maxTopRecircItems);
            const content = top.length
                ? top.map((lane, i) => `
                    <div class="fcv-pro-top-line ${severityClass(lane.recircValue)}" title="${escapeHtml(lane.laneLabel)}: ${lane.recircValue}">
                        <span class="fcv-pro-top-lane">${i + 1}. ${escapeHtml(lane.laneLabel)} ${fpAssociateBadge(lane)}</span>
                        <span class="fcv-pro-top-count">${lane.recircValue}</span>
                    </div>
                `).join("")
                : `<div class="fcv-pro-empty">No recirc</div>`;
            return `<td style="color:${CHUTE_COLORS[key]}">${content}</td>`;
        }).join("");

        panel.innerHTML = `
            <div class="fcv-pro-panel-title">Top Recirculating Lanes by Area</div>
            <table>
                <thead><tr class="fcv-pro-area-row">${areaRow}</tr></thead>
                <tbody><tr>${laneRow}</tr></tbody>
            </table>
        `;
    }

    function headerMapFromHeaders(headers) {
        const map = {};
        headers.forEach((header, index) => {
            const text = lower(header);
            if (text.includes("chute")) map.chute = index;
            if (text.includes("stacking filter")) map.stackingFilter = index;
            if (text.includes("resources")) map.resources = index;
            if (text.includes("slam received")) map.slamReceived = index;
            if (text.includes("next cpt")) map.nextCpt = index;
        });
        if (!Number.isInteger(map.chute) || !Number.isInteger(map.resources) || !Number.isInteger(map.slamReceived)) return null;
        if (!Number.isInteger(map.nextCpt)) map.nextCpt = headers.length - 1;
        return map;
    }

    function sortRows(rows) {
        if (STATE.sortIndex === null) return rows;

        const index = STATE.sortIndex;
        const dir = STATE.sortDirection === "asc" ? 1 : -1;

        return [...rows].sort((a, b) => {
            const av = a.cells[index] ?? "";
            const bv = b.cells[index] ?? "";
            const an = Number(String(av).replace(/[^\d.-]/g, ""));
            const bn = Number(String(bv).replace(/[^\d.-]/g, ""));
            if (Number.isFinite(an) && Number.isFinite(bn) && (String(av).match(/\d/) || String(bv).match(/\d/))) return (an - bn) * dir;
            return String(av).localeCompare(String(bv)) * dir;
        });
    }

    function handleSort(index) {
        if (STATE.sortIndex === index) STATE.sortDirection = STATE.sortDirection === "asc" ? "desc" : "asc";
        else {
            STATE.sortIndex = index;
            STATE.sortDirection = "desc";
        }
        renderAll();
    }

    function renderAllTable(cached) {
        let panel = document.getElementById(CONFIG.ids.allTable);
        document.body.classList.remove("fcv-pro-all-mode");

        if (!STATE.panels.allTable) {
            if (panel) panel.remove();
            return;
        }

        panel = panelAfterPrevious(CONFIG.ids.allTable);
        const headers = cached.headers || STATE.headers || [];
        const map = headerMapFromHeaders(headers);
        const visibleRows = sortRows(cached.rows.filter(row => filterPass(row.family.key, row.disabled, row.recircValue)));

        panel.innerHTML = `
            <div class="fcv-pro-all-title">Cached Lanes (${visibleRows.length} visible / ${cached.rows.length} cached)</div>
            <table>
                <thead>
                    <tr>
                        ${headers.map((header, index) => {
                            const arrow = STATE.sortIndex === index ? (STATE.sortDirection === "asc" ? " ▲" : " ▼") : "";
                            return `<th data-sort="${index}">${escapeHtml(header)}${arrow}</th>`;
                        }).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${visibleRows.map(row => {
                        const tds = row.cells.map((value, index) => {
                            let style = "";
                            let title = "";

                            if (map && index >= map.chute && index <= map.resources) {
                                const bg = row.disabled ? STATUS_COLORS.disabled : row.family.color;
                                style = `background:${bg};color:${colorText(bg)};font-weight:700;`;
                                title = row.disabled ? "Disabled: blank stacking filter" : row.family.label;
                            } else if (map && index >= map.slamReceived && index <= map.nextCpt) {
                                style = `background:${row.status.color};color:#111;`;
                                title = row.status.tooltip;
                            }

                            return `<td style="${style}" title="${escapeHtml(title)}">${escapeHtml(value)}</td>`;
                        }).join("");
                        return `<tr>${tds}</tr>`;
                    }).join("")}
                </tbody>
            </table>
        `;

        Array.from(panel.querySelectorAll("th[data-sort]")).forEach(th => {
            th.addEventListener("click", () => handleSort(Number(th.dataset.sort)));
        });
    }

    function applyOriginalTableColoring() {
        if (STATE.panels.allTable) return;

        const table = getMainTable();
        if (!table) return;

        const map = getHeaderMap(table);
        if (!map) return;

        Array.from(table.querySelectorAll("tbody tr")).forEach(row => {
            if (!row.children || row.children.length <= map.slamReceived) return;

            const cells = Array.from(row.children);
            const extracted = extractCurrentRows().rows.find(r => r.cells.join("|") === cells.map(c => norm(c.textContent)).join("|"));
            if (!extracted) return;

            cells.forEach(cell => {
                cell.style.backgroundColor = "";
                cell.style.color = "";
                cell.title = "";
                cell.classList.remove("fcv-pro-chute-zone");
            });

            for (let i = map.chute; i <= map.resources && i < cells.length; i++) {
                const bg = extracted.disabled ? STATUS_COLORS.disabled : extracted.family.color;
                cells[i].style.backgroundColor = bg;
                cells[i].style.color = colorText(bg);
                cells[i].title = extracted.disabled ? "Disabled: blank stacking filter" : extracted.family.label;
                cells[i].classList.add("fcv-pro-chute-zone");
            }

            for (let i = map.slamReceived; i <= map.nextCpt && i < cells.length; i++) {
                cells[i].style.backgroundColor = extracted.status.color;
                cells[i].style.color = "#111";
                cells[i].title = extracted.status.tooltip;
            }

            const visible = filterPass(extracted.family.key, extracted.disabled, extracted.recircValue);
            row.classList.toggle("fcv-pro-row-hidden", !visible);
            row.style.display = visible ? "" : "none";
        });
    }

    async function scanAllPages() {
        if (STATE.scanRunning) return;

        STATE.scanRunning = true;
        renderControlBar();

        try {
            addRowsToCache(extractCurrentRows().rows);

            const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
                .map(button => ({ button, page: Number(norm(button.textContent)) }))
                .filter(item => Number.isInteger(item.page) && item.page > 0)
                .sort((a, b) => a.page - b.page);

            const seen = new Set();

            for (const item of buttons) {
                if (seen.has(item.page)) continue;
                seen.add(item.page);

                item.button.click();
                await sleep(CONFIG.scanDelayMs);
                addRowsToCache(extractCurrentRows().rows);
                renderControlBar();
            }

            STATE.panels.allTable = true;
            savePrefs();
        } finally {
            STATE.scanRunning = false;
            renderAll();
        }
    }

    function removeOldRecircArea() {
        Array.from(document.querySelectorAll("button, .collapsible"))
            .filter(el => lower(el.textContent).includes("detailed recirc data"))
            .forEach(button => {
                if (button.nextElementSibling && button.nextElementSibling.id === "recirc") button.nextElementSibling.remove();
                button.remove();
            });

        const recirc = document.getElementById("recirc");
        if (recirc) recirc.remove();

        Array.from(document.querySelectorAll(".predict")).forEach(table => {
            const caption = lower(table.querySelector("caption")?.textContent || "");
            if (caption.includes("lane watch") || caption.includes("by area")) table.remove();
        });
    }

    function renderAll() {
        if (!isForesightPage()) return;

        ensureCreatorSignature();

        STATE.hidden = false;
        STATE.panels.allTable = false;
        document.body.classList.toggle("fcv-pro-master-collapsed", STATE.collapsed);
        document.body.classList.remove("fcv-pro-master-hidden");
        document.body.classList.remove("fcv-pro-all-mode");
        ensureShowTab();
        removeOldRecircArea();

        renderControlBar();
        updateToolbarOffset();
        /* legend merged into top row */

        const current = extractRealForesightRows();
        addRowsToCache(current.rows);
        const fullDom = refreshRealForesightLaneCache();
        const cached = getCachedRows();

        renderGrafanaPanel();
        renderAllocationsPanel();

        fpRenderVastPanel();
        renderTopRecircPanel(dedupeLaneRowsByHighestRecirc(cached.rows.length ? cached.rows : (fullDom.rows.length ? fullDom.rows : current.rows)));

        const existingAllTable = document.getElementById(CONFIG.ids.allTable);
        if (existingAllTable) existingAllTable.remove();

        applyOriginalTableColoring();
    }


    function isAllocationPage() {
        return location.href.includes("CrossBeltSorterAutoRecommendations");
    }

    function shouldRefreshAllocationsNow() {
        const now = new Date();
        return CONFIG.allocationScheduleMinutes.includes(now.getMinutes()) && now.getSeconds() <= 10;
    }

    let lastAllocationAutoRefreshKey = "";

    function maybeAutoRefreshAllocations() {
        const now = new Date();
        const key = `${now.getHours()}:${now.getMinutes()}`;

        if (shouldRefreshAllocationsNow() && key !== lastAllocationAutoRefreshKey) {
            lastAllocationAutoRefreshKey = key;
            refreshAllocationsHiddenFrame();
            renderAll();
        }
    }


    function ensureCreatorSignature() {
        let signature = document.getElementById("fcv-pro-creator-signature");

        if (!signature) {
            signature = document.createElement("div");
            signature.id = "fcv-pro-creator-signature";
            signature.textContent = "Foresight Plus v44 • @janazare";
            document.body.appendChild(signature);
        }
    }

    function startForesight() {
        loadPrefs();
        renderAll();
        setTimeout(refreshAllocationsHiddenFrame, 2500);
        setTimeout(fpRefreshStemAssociates, 3000);
        setTimeout(fpRefreshVastAlerts, 3500);
        setTimeout(() => autoSortRecircDescending(true).then(() => harvestAllPaginationPagesForTopRecirc(true)).then(renderAll), 2500);
        setTimeout(() => harvestAllPaginationPagesForTopRecirc(true).then(renderAll), 3000);
        setTimeout(() => {
            refreshRealForesightLaneCache();
            renderAll();
        }, 3500);
        setTimeout(silentScanAllPagesForTopRecirc, 3500);

        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(renderAll, 150);
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["hidden", "aria-hidden", "style", "class"]
        });

        setInterval(cleanFloatingForesightStickyElements, 500);

        setInterval(() => {
            maybeAutoRefreshAllocations();
            autoSortRecircDescending(false);
            silentScanAllPagesForTopRecirc();
            renderAll();
        }, CONFIG.refreshMs);
    }

    function startGrafana() {
        scrapeGrafanaLaneWatch();
        setInterval(scrapeGrafanaLaneWatch, CONFIG.grafanaRefreshMs);
    }


    GM_addStyle(`

/* FCV Pro v35 toolbar spacing fix */
:root {
    --fcv-pro-toolbar-height: 58px;
}

body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height) !important;
}

#fcv-pro-control-bar {
    min-height: 42px !important;
    box-sizing: border-box !important;
}

#fcv-pro-grafana-panel,
#fcv-pro-allocations-panel,
#fcv-pro-top-recirc {
    scroll-margin-top: calc(var(--fcv-pro-toolbar-height) + 8px) !important;
}

#fcv-pro-grafana-panel {
    margin-top: 8px !important;
}

/* FCV Pro v34 stable UI */
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
    margin: 0 !important;
    border-radius: 0 !important;
    background: #111827 !important;
    box-shadow: 0 2px 8px rgba(0,0,0,.28) !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 8px !important;
}
body.fcv-pro-has-fixed-bar { padding-top: var(--fcv-pro-toolbar-height) !important; }
#fcv-pro-control-bar .fcv-pro-title,
#fcv-pro-legend,
button[data-panel="legend"],
#fcv-pro-reset { display: none !important; }
#fcv-pro-control-bar .fcv-pro-left-controls,
#fcv-pro-control-bar .fcv-pro-right-controls {
    display: inline-flex !important;
    align-items: center !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
}
#fcv-pro-control-bar .fcv-pro-left-controls { flex: 1 1 auto !important; }
#fcv-pro-control-bar .fcv-pro-right-controls { justify-content: flex-end !important; }
#fcv-pro-control-bar .fcv-pro-inline-legend {
    display: inline-flex !important;
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 6px 8px !important;
}
#fcv-pro-control-bar .fcv-pro-inline-legend span {
    display: inline-flex !important;
    align-items: center !important;
    white-space: nowrap !important;
    font-size: 11px !important;
    font-weight: 900 !important;
    color: #ffffff !important;
}
#fcv-pro-control-bar .fcv-pro-inline-legend b {
    width: 11px !important;
    height: 11px !important;
    min-width: 11px !important;
    display: inline-block !important;
    border-radius: 2px !important;
    border: 1px solid rgba(255,255,255,.75) !important;
    margin-right: 3px !important;
}
#fcv-pro-dark-toggle { min-width: 34px; font-size: 14px !important; }
#fcv-pro-grafana-panel .fcv-pro-panel-title {
    background: #1F4E79 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}
#fcv-pro-allocations-panel .fcv-pro-panel-title {
    background: #2E7D32 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}
#fcv-pro-top-recirc .fcv-pro-panel-title {
    background: #374151 !important;
    background-image: none !important;
    color: #ffffff !important;
    text-shadow: none !important;
}
#fcv-pro-grafana-panel .fcv-pro-panel-subtitle { display: none !important; }
.awsui-table-container,
.awsui-table-container *,
[class*="awsui-table-container"],
[class*="awsui-table-container"] *,
table thead,
table thead tr,
table thead th {
    position: static !important;
    top: auto !important;
    bottom: auto !important;
    transform: none !important;
}
#fcv-pro-allocations-panel .fcv-pro-allocation-card {
    padding: 2px 3px !important;
    margin: 0 0 2px 0 !important;
    line-height: 11px !important;
}
#fcv-pro-allocations-panel .fcv-pro-allocation-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
}
#fcv-pro-allocations-panel .fcv-pro-allocation-chute {
    min-width: auto !important;
    padding: 1px 4px !important;
    margin-right: 0 !important;
    font-size: 10px !important;
    line-height: 12px !important;
}
#fcv-pro-allocations-panel .fcv-pro-status-pill {
    min-width: auto !important;
    padding: 1px 5px !important;
    font-size: 9px !important;
    line-height: 12px !important;
    white-space: nowrap;
}
#fcv-pro-allocations-panel .fcv-pro-subtext {
    margin-top: 1px;
    font-size: 9px !important;
    line-height: 10px !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#fcv-pro-allocations-panel .fcv-pro-allocation-filter,
#fcv-pro-allocations-panel .fcv-pro-allocation-meta { display: none !important; }
#fcv-pro-top-recirc .fcv-pro-top-line {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 0 0 2px 0;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 900;
    border-bottom: 1px solid #e5e7eb;
}
#fcv-pro-top-recirc .fcv-pro-top-lane {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#fcv-pro-top-recirc .fcv-pro-top-count {
    min-width: 24px;
    text-align: right;
}
#fcv-pro-top-recirc .fcv-pro-top-good { background: #E8F5E9; color: #2E7D32; }
#fcv-pro-top-recirc .fcv-pro-top-warning { background: #FFF4D6; color: #B45309; }
#fcv-pro-top-recirc .fcv-pro-top-severe { background: #FDE2E1; color: #D13212; }
body.fcv-pro-dark-mode,
body.fcv-pro-dark-mode main,
body.fcv-pro-dark-mode [class*="awsui"],
body.fcv-pro-dark-mode .awsui-table-container {
    background-color: #0f172a !important;
    color: #e5e7eb !important;
}
body.fcv-pro-dark-mode input,
body.fcv-pro-dark-mode select,
body.fcv-pro-dark-mode textarea {
    background-color: #111827 !important;
    color: #f9fafb !important;
    border-color: #374151 !important;
}
body.fcv-pro-dark-mode table,
body.fcv-pro-dark-mode tbody,
body.fcv-pro-dark-mode tr,
body.fcv-pro-dark-mode td,
body.fcv-pro-dark-mode th {
    border-color: #374151 !important;
}
body.fcv-pro-dark-mode table th {
    background-color: #1f2937 !important;
    color: #f9fafb !important;
}
body.fcv-pro-dark-mode #fcv-pro-grafana-panel,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel,
body.fcv-pro-dark-mode #fcv-pro-top-recirc {
    background: #111827 !important;
    color: #e5e7eb !important;
    border-color: #374151 !important;
}
body.fcv-pro-dark-mode .fcv-pro-panel-subtitle,
body.fcv-pro-dark-mode .fcv-pro-card-title,
body.fcv-pro-dark-mode .fcv-pro-actions {
    background: #1f2937 !important;
    color: #e5e7eb !important;
    border-color: #374151 !important;
}
body.fcv-pro-dark-mode .fcv-pro-empty,
body.fcv-pro-dark-mode .fcv-pro-subtext { color: #cbd5e1 !important; }
body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-good-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-good {
    background: #12351f !important;
    color: #86efac !important;
}
body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-warning-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-warning {
    background: #422f0b !important;
    color: #fbbf24 !important;
}
body.fcv-pro-dark-mode #fcv-pro-grafana-panel .fcv-pro-severe-row,
body.fcv-pro-dark-mode #fcv-pro-top-recirc .fcv-pro-top-severe {
    background: #451a1a !important;
    color: #fca5a5 !important;
}
`);


    GM_addStyle(`
/* FCV Pro v36 final safety override */
body.fcv-pro-dark-mode,
body.fcv-pro-dark-mode main,
body.fcv-pro-dark-mode [class*="awsui"],
body.fcv-pro-dark-mode .awsui-table-container {
    background-color: revert !important;
    color: revert !important;
}
body.fcv-pro-dark-mode input,
body.fcv-pro-dark-mode select,
body.fcv-pro-dark-mode textarea {
    background-color: revert !important;
    color: revert !important;
    border-color: revert !important;
}
/* Reapply dark mode to FCV panels only after the revert above */
body.fcv-pro-dark-mode #fcv-pro-grafana-panel,
body.fcv-pro-dark-mode #fcv-pro-allocations-panel,
body.fcv-pro-dark-mode #fcv-pro-top-recirc {
    background: #111827 !important;
    color: #e5e7eb !important;
    border-color: #374151 !important;
}
`);


    GM_addStyle(`
/* FCV Pro v37 final safety */
body.fcv-pro-dark-mode {
    background-color: inherit !important;
    color: inherit !important;
}

/* Aggressively stop non-FCV Foresight table containers from floating fixed/sticky in viewport */
body:not(.fcv-pro-allow-floating) *:not(#fcv-pro-control-bar):not(#fcv-pro-control-bar *):not(#fcv-pro-creator-signature) {
    scroll-margin-top: var(--fcv-pro-toolbar-height, 58px) !important;
}

#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
}

body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}
`);


    GM_addStyle(`
/* FCV Pro v39 single-scroll safety */
html, body {
    overflow-y: auto !important;
}
body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
}
/* Do not force table headers static anymore. Duplicate clone rows are handled by JS. */
table thead,
table thead tr,
table thead th {
    transform: none !important;
}
`);


    GM_addStyle(`
/* FCV Pro v40 targeted AWSUI fixes */
.awsui-table-header-copy {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
}
html, body {
    overflow-y: auto !important;
}
body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
}
#fcv-pro-creator-signature {
    position: fixed !important;
    left: 3px !important;
    bottom: 8px !important;
    z-index: 2147483001 !important;
    writing-mode: vertical-rl !important;
    transform: rotate(180deg) !important;
    font-size: 10px !important;
    line-height: 10px !important;
    font-weight: 800 !important;
    letter-spacing: .5px !important;
    color: rgba(255,255,255,.18) !important;
    pointer-events: none !important;
    user-select: none !important;
}
`);


    GM_addStyle(`
/* Foresight Plus v44 final UI */
.awsui-table-header-copy {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
}
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
}
body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}
#fcv-pro-creator-signature {
    position: fixed !important;
    left: 3px !important;
    bottom: 8px !important;
    z-index: 2147483001 !important;
    writing-mode: vertical-rl !important;
    transform: rotate(180deg) !important;
    font-size: 10px !important;
    line-height: 10px !important;
    font-weight: 800 !important;
    letter-spacing: .5px !important;
    color: rgba(255,255,255,.18) !important;
    pointer-events: none !important;
    user-select: none !important;
}
`);


    GM_addStyle(`
/* Foresight Plus v44 version label + watermark */
#fcv-pro-version-label {
    font-size: 12px !important;
    line-height: 14px !important;
    font-weight: 800 !important;
    color: #9fb3c8 !important;
    margin-left: 4px !important;
    margin-right: 4px !important;
    white-space: nowrap !important;
}
#fcv-pro-creator-signature {
    position: fixed !important;
    left: 4px !important;
    bottom: 10px !important;
    z-index: 2147483001 !important;
    writing-mode: vertical-rl !important;
    transform: rotate(180deg) !important;
    font-size: 12px !important;
    line-height: 12px !important;
    font-weight: 900 !important;
    letter-spacing: .8px !important;
    color: rgba(255,255,255,.30) !important;
    background: transparent !important;
    pointer-events: none !important;
    user-select: none !important;
    text-shadow: 0 1px 1px rgba(0,0,0,.40) !important;
}
`);


    GM_addStyle(`
/* Foresight Plus v44 safety */
.awsui-table-header-copy {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
}
#fcv-pro-control-bar {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100vw !important;
    z-index: 2147483000 !important;
}
body.fcv-pro-has-fixed-bar {
    padding-top: var(--fcv-pro-toolbar-height, 58px) !important;
}
#fcv-pro-version-label {
    font-size: 12px !important;
    line-height: 14px !important;
    font-weight: 800 !important;
    color: #9fb3c8 !important;
    margin-left: 4px !important;
    margin-right: 4px !important;
    white-space: nowrap !important;
}
#fcv-pro-creator-signature {
    position: fixed !important;
    left: 4px !important;
    bottom: 10px !important;
    z-index: 2147483001 !important;
    writing-mode: vertical-rl !important;
    transform: rotate(180deg) !important;
    font-size: 12px !important;
    line-height: 12px !important;
    font-weight: 900 !important;
    letter-spacing: .8px !important;
    color: rgba(255,255,255,.30) !important;
    background: transparent !important;
    pointer-events: none !important;
    user-select: none !important;
    text-shadow: 0 1px 1px rgba(0,0,0,.40) !important;
}
`);


    // ---------- Foresight Plus v44 integrations ----------
    const FP_URLS = {
        scarta: "https://command.sorttech.amazon.dev/workstations/rightStation",
        troubleshoot: "https://trans-logistics.amazon.com/sortcenter/tantei?nodeId=PSP1",
        stemContainerBuild: "https://stem-na.corp.amazon.com/workstationsv2/node/PSP1/type/containerBuild",
        grafana: "https://grafana-prod.prod.us-east-1.grafana.insights.aft.amazon.dev/d/YIQVoijMk/myspd-site-dashboard-2-0?orgId=1&from=now-5m&to=now&var-building=PSP1&var-Sorter=ShipSorter&var-Sub_Sorter=shippingsorter1&var-metricPeriod=5min&var-Scanner=All&refresh=5m",
        vast: "https://na.vast.ops-integration.amazon.dev/"
    };

    function fpOpen(url) {
        window.open(url, "_blank", "noopener,noreferrer");
    }

    function fpLocationAliases(locationText) {
        const raw = norm(locationText);
        const upper = raw.toUpperCase();
        const aliases = new Set();
        if (!upper) return aliases;
        aliases.add(upper);

        const spiral = upper.match(/SPIRAL\s*(\d+)/);
        if (spiral) {
            const n = String(Number(spiral[1])).padStart(4, "0");
            aliases.add(`SR-${n}-A`);
            aliases.add(`SR-${n}`);
            aliases.add(`S${n}`);
        }

        const chute = upper.match(/\b(SR|FR|DD)[-\s]?0*(\d{1,4})(?:-A)?\b/);
        if (chute) {
            const prefix = chute[1];
            const n = String(Number(chute[2])).padStart(prefix === "DD" ? 3 : 4, "0");
            aliases.add(prefix === "DD" ? `${prefix}${n}` : `${prefix}-${n}-A`);
            aliases.add(prefix === "DD" ? `${prefix}${Number(chute[2])}` : `${prefix}-${n}`);
        }
        return aliases;
    }

    function fpLaneAliases(rowOrLabel) {
        const text = typeof rowOrLabel === "string" ? rowOrLabel : `${rowOrLabel?.laneLabel || ""} ${rowOrLabel?.resourceText || ""} ${rowOrLabel?.chuteText || ""}`;
        return fpLocationAliases(text);
    }

    function fpBuildAssociateMap(records) {
        const byAlias = {};
        (records || []).forEach(item => {
            const associateId = norm(item.associateId || item.login || item.userId || item.employeeId);
            const location = norm(item.lastScanLocation || item.currentLocation || item.workstationAlias || item.location);
            if (!associateId || !location) return;
            const record = { associateId, location, scanCount: Number(item.scanCount || item.secondCount || 0), signedIn: item.signedIn !== false };
            fpLocationAliases(location).forEach(alias => { byAlias[alias] = record; });
        });
        return { byAlias, capturedAt: new Date().toLocaleString(), capturedAtMs: Date.now() };
    }

    function fpGetAssociateForLane(rowOrLabel) {
        const cache = GM_getValue("fp_stem_associates_cache", null);
        if (!cache?.byAlias) return null;
        for (const alias of fpLaneAliases(rowOrLabel)) {
            if (cache.byAlias[alias]) return cache.byAlias[alias];
        }
        return null;
    }

    function fpAssociateBadge(rowOrLabel) {
        const associate = fpGetAssociateForLane(rowOrLabel);
        if (!associate) return `<span class="fp-associate-missing" title="No associate found">⚠ Unassigned</span>`;
        return `<span class="fp-associate-badge" title="${escapeHtml(associate.location)}">👤 ${escapeHtml(associate.associateId)}</span>`;
    }

    function fpGmGetJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                responseType: "json",
                onload: response => {
                    try {
                        const raw = response.response || response.responseText;
                        resolve(typeof raw === "string" ? JSON.parse(raw) : raw);
                    } catch (e) { reject(e); }
                },
                onerror: reject
            });
        });
    }

    function fpGmPostJson(url, payload) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url,
                data: JSON.stringify(payload),
                headers: { "Accept": "application/graphql+json, application/json", "Content-Type": "application/json" },
                responseType: "json",
                onload: response => {
                    try {
                        const raw = response.response || response.responseText;
                        resolve(typeof raw === "string" ? JSON.parse(raw) : raw);
                    } catch (e) { reject(e); }
                },
                onerror: reject
            });
        });
    }

    function fpExtractStemAssociatesFromGraphql(data) {
        const found = [];
        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (node.associateData && Array.isArray(node.associateData.perAssociateData)) {
                node.associateData.perAssociateData.forEach(item => {
                    found.push({
                        associateId: item.associateId,
                        scanCount: item.scanCount || item.secondCount,
                        lastScanLocation: item.lastScanLocation || node.workstation?.workstationAlias,
                        signedIn: item.signedIn
                    });
                });
            }
            Object.keys(node).forEach(key => walk(node[key]));
        }
        walk(data);
        return found;
    }

    async function fpRefreshStemAssociates() {
        const payload = {
            operationName: "getWorkstationDataWindow",
            variables: { nodeId: "PSP1", minutes: 45 },
            query: `query getWorkstationDataWindow($nodeId: String!, $minutes: Int!) {
  workstationDataWindow(nodeId: $nodeId, minutes: $minutes) {
    workstationData {
      workstation { workstationId workstationAlias workstationName __typename }
      associateData {
        completeness
        perAssociateData {
          associateId
          scanCount
          lastScanTime
          lastScanLocation
          signedIn
          signInDurationMS
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`
        };
        try {
            const data = await fpGmPostJson("https://na.prod.wattwebsite.sorttech.amazon.dev/graphql", payload);
            const cache = fpBuildAssociateMap(fpExtractStemAssociatesFromGraphql(data));
            GM_setValue("fp_stem_associates_cache", cache);
            return cache;
        } catch (e) {
            return GM_getValue("fp_stem_associates_cache", null);
        }
    }

    async function fpRefreshVastAlerts() {
        const base = "https://api.na.vast.ops-integration.amazon.dev/query_listing_data";
        const normalizeRows = (data, type) => {
            const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.listingData) ? data.listingData : [];
            return rows.map(row => ({
                type,
                location: norm(row.location || row.Location || row.chute || row.Chute || row.stacking_area || row.stackingArea || row["Stacking area"]),
                container: norm(row.container_label || row.containerLabel || row.Container || row["Container label"] || row.container || ""),
                stackingFilter: norm(row.stacking_filter || row.stackingFilter || row["Stacking filter"] || ""),
                packages: row.packages || row.Packages || "",
                dwell: row.dwelling_time || row.dwellingTime || row["Dwelling Time (minutes)"] || "",
                status: norm(row.status || row.Status || "")
            })).filter(row => row.location || row.container || row.stackingFilter);
        };
        try {
            const [vpm, missing] = await Promise.all([
                fpGmGetJson(`${base}?metric=chute_vpm&minutes_back_limit=180&whid=PSP1`),
                fpGmGetJson(`${base}?metric=missing_container&minutes_back_limit=180&whid=PSP1`)
            ]);
            const cache = { capturedAt: new Date().toLocaleString(), capturedAtMs: Date.now(), chuteVpm: normalizeRows(vpm, "CREATION"), missingContainer: normalizeRows(missing, "MISSING") };
            GM_setValue("fp_vast_alerts_cache", cache);
            return cache;
        } catch (e) {
            return GM_getValue("fp_vast_alerts_cache", null);
        }
    }

    function fpRenderVastPanel() {
        let panel = document.getElementById("fcv-pro-vast-panel");
        if (!STATE.panels.vast) { if (panel) panel.remove(); return; }
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "fcv-pro-vast-panel";
            panel.className = "fcv-pro-panel fp-panel-card";
        }
        const cache = GM_getValue("fp_vast_alerts_cache", null);
        const creation = (cache?.chuteVpm || []).slice(0, 8);
        const missing = (cache?.missingContainer || []).slice(0, 8);
        const rowHtml = (row, badgeClass, badgeText) => `
            <div class="fp-vast-row">
                <span class="fp-vast-loc">${escapeHtml(row.location || row.container)}</span>
                ${row.container ? `<span class="fp-vast-container">${escapeHtml(row.container)}</span>` : ""}
                ${row.stackingFilter ? `<span class="fp-vast-filter">${escapeHtml(row.stackingFilter)}</span>` : ""}
                <span class="${badgeClass}">${badgeText}</span>
            </div>`;
        panel.innerHTML = `
            <div class="fcv-pro-panel-title fp-title-vast"><span>VAST</span><span class="fp-title-meta">${cache?.capturedAt ? `Updated ${escapeHtml(cache.capturedAt)}` : "No cache yet"}</span></div>
            <div class="fp-vast-grid">
                <div><div class="fp-mini-head">Chute VPM</div>${creation.length ? creation.map(row => rowHtml(row, "fp-badge-create", "CREATION")).join("") : `<div class="fcv-pro-empty">No Chute VPM</div>`}</div>
                <div><div class="fp-mini-head">Missing Container</div>${missing.length ? missing.map(row => rowHtml(row, "fp-badge-missing", "MISSING")).join("") : `<div class="fcv-pro-empty">No Missing Container</div>`}</div>
            </div>`;
        ensureRoot().appendChild(panel);
    }

    function fpStartStemBridge() {
        function scrapeVisibleAssociates() {
            const items = [];
            Array.from(document.querySelectorAll("tr, [role='row']")).forEach(row => {
                const text = norm(row.textContent || "");
                const loginMatch = text.match(/\b[a-z][a-z0-9]{3,}\b/);
                const locMatch = text.match(/\b(Spiral\s*\d+|SR[-\s]?\d{1,4}(?:-A)?|FR[-\s]?\d{1,4}(?:-A)?|DD\d{1,4})\b/i);
                if (loginMatch && locMatch) items.push({ associateId: loginMatch[0], lastScanLocation: locMatch[0] });
            });
            if (items.length) GM_setValue("fp_stem_associates_cache", fpBuildAssociateMap(items));
        }
        setTimeout(scrapeVisibleAssociates, 1000);
        setInterval(scrapeVisibleAssociates, 15000);
    }

    function fpStartVastBridge() {
        fpRefreshVastAlerts();
        setInterval(fpRefreshVastAlerts, 60000);
    }

    function fpStartGrafanaBridge() {
        // v44 safety: do not inject UI/CSS into Grafana. Existing Foresight-side Grafana refresh still uses cached data if available.
        return;
    }



    GM_addStyle(`
/* Foresight Plus v44 modern UI + single scroll */
#fcv-pro-control-bar {
    position: sticky !important;
    top: 0 !important;
    width: 100% !important;
    min-height: 66px !important;
    z-index: 2147483000 !important;
    background: #0f172a !important;
    border-bottom: 3px solid #38bdf8 !important;
    box-shadow: 0 3px 10px rgba(15,23,42,.28) !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 4px !important;
    padding: 5px 8px !important;
    box-sizing: border-box !important;
}
body.fcv-pro-has-fixed-bar { padding-top: 0 !important; }
.fp-toolbar-row { display: flex !important; align-items: center !important; gap: 6px !important; width: 100% !important; }
.fp-toolbar-main { justify-content: space-between !important; }
.fp-toolbar-links { justify-content: flex-start !important; flex-wrap: wrap !important; }
.fp-toolbar-left,.fp-toolbar-right { display: inline-flex !important; align-items: center !important; gap: 6px !important; flex-wrap: wrap !important; }
#fcv-pro-version-label {
    color: #cbd5e1 !important; font-size: 12px !important; font-weight: 900 !important;
    padding: 2px 8px !important; border: 1px solid #334155 !important; border-radius: 999px !important; background: #111827 !important;
}
.fp-group-label { color: #93c5fd !important; font-size: 11px !important; font-weight: 900 !important; text-transform: uppercase !important; }
.fp-group-spacer { flex: 1 1 auto !important; }
#fcv-pro-control-bar button {
    border-radius: 7px !important; border: 1px solid #334155 !important; padding: 3px 8px !important;
    font-size: 11px !important; font-weight: 900 !important; cursor: pointer !important;
}
#fcv-pro-control-bar .fp-link-btn { background: #1e293b !important; color: #e0f2fe !important; }
#fcv-pro-control-bar button[data-panel] { background: #22c55e !important; color: #03120a !important; }
#fcv-pro-control-bar button.fcv-pro-off { background: #64748b !important; color: #f8fafc !important; }
#fcv-pro-container,#fcv-pro-root,.fcv-pro-root {
    border: 3px solid #334155 !important; border-radius: 12px !important; overflow: visible !important; margin: 6px 0 !important;
    box-shadow: 0 6px 18px rgba(15,23,42,.18) !important;
}
.fcv-pro-panel,.fp-panel-card {
    border: 2px solid #475569 !important; border-radius: 10px !important; overflow: hidden !important; margin: 6px 4px !important; background: #ffffff !important;
}
.fcv-pro-panel-title { border-bottom: 2px solid rgba(0,0,0,.18) !important; padding: 4px 8px !important; font-weight: 900 !important; }
.fp-title-vast { background: #581c87 !important; color: white !important; display: flex !important; justify-content: space-between !important; }
.fp-title-meta { font-size: 10px !important; opacity: .85 !important; }
.fp-vast-grid { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 8px !important; padding: 6px !important; }
.fp-mini-head { font-size: 11px !important; font-weight: 900 !important; color: #334155 !important; border-bottom: 1px solid #cbd5e1 !important; margin-bottom: 4px !important; }
.fp-vast-row { display: flex !important; align-items: center !important; gap: 5px !important; border-bottom: 1px solid #e5e7eb !important; padding: 3px 2px !important; font-size: 11px !important; }
.fp-vast-loc { font-weight: 900 !important; color: #0f172a !important; min-width: 64px !important; }
.fp-vast-container,.fp-vast-filter { color: #334155 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
.fp-badge-create,.fp-badge-missing { margin-left: auto !important; border-radius: 999px !important; padding: 1px 6px !important; font-size: 9px !important; font-weight: 900 !important; }
.fp-badge-create { background: #fb923c !important; color: #431407 !important; }
.fp-badge-missing { background: #ef4444 !important; color: white !important; }
.fp-associate-badge {
    display: inline-block !important; margin-left: 4px !important; padding: 1px 5px !important; border-radius: 999px !important;
    background: #dbeafe !important; color: #1e3a8a !important; font-size: 10px !important; font-weight: 900 !important;
}
.fp-associate-missing {
    display: inline-block !important; margin-left: 4px !important; padding: 1px 5px !important; border-radius: 999px !important;
    background: #fee2e2 !important; color: #991b1b !important; font-size: 10px !important; font-weight: 900 !important;
}
#fcv-pro-creator-signature {
    position: fixed !important; left: 4px !important; bottom: 10px !important; z-index: 2147483001 !important;
    writing-mode: vertical-rl !important; transform: rotate(180deg) !important; font-size: 12px !important; line-height: 12px !important;
    font-weight: 900 !important; letter-spacing: .8px !important; color: rgba(20,20,20,.36) !important;
    background: transparent !important; pointer-events: none !important; user-select: none !important; text-shadow: 0 1px 1px rgba(255,255,255,.5) !important;
}
.awsui-table-header-copy { display: none !important; visibility: hidden !important; pointer-events: none !important; }
.awsui-table-container,[class*="awsui-table-container"],.awsui-table-inner,[class*="awsui-table-inner"],.awsui-table-wrapper,[class*="awsui-table-wrapper"] {
    max-height: none !important; height: auto !important; overflow: visible !important;
}
`);

    function start() {
        if (isGrafanaPage()) {
            fpStartGrafanaBridge();
            return;
        }
        if (isStemPage()) {
            fpStartStemBridge();
            return;
        }
        if (isVastPage()) {
            fpStartVastBridge();
            return;
        }

        console.debug("[FCV Pro] initialized", BUILD);
        if (isGrafanaPage()) startGrafana();
        else if (isForesightPage()) startForesight();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
