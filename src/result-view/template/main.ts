import { Button, DataGrid, DataGridCell, ProgressRing, provideVSCodeDesignSystem, vsCodeButton, vsCodeDataGrid, vsCodeDataGridCell, vsCodeDataGridRow, vsCodeDivider, vsCodeDropdown, vsCodeOption, vsCodeProgressRing, vsCodeTextField } from "@vscode/webview-ui-toolkit";
// @ts-expect-error html as text
import html from './main.html';
import "./main.css";
provideVSCodeDesignSystem().register(
    vsCodeButton(),
    vsCodeDropdown(),
    vsCodeOption(),
    vsCodeTextField(),
    vsCodeDivider(),
    vsCodeDataGrid(),
    vsCodeDataGridCell(),
    vsCodeDataGridRow(),
    vsCodeProgressRing()
);

const vscode = acquireVsCodeApi();

window.addEventListener("load", main);

function main() {

  (document.querySelector("#main") as HTMLElement).innerHTML = html;

  setTimeout(() => {
    const zeroResults = document.querySelector<HTMLElement>("#zero-results");
    const results = document.querySelector<HTMLElement>("#results");
    const exportButton = document.querySelector<Button>("#export-button");
    const loading = document.querySelector<ProgressRing>("#loading");
  
    if (!zeroResults || !loading || !results) throw new Error();
    window.addEventListener("message", event => {
      const data = event.data.data;
      loading.classList.add("rv-hidden");
      if (data.tableBody.length) {
        zeroResults.classList.add("rv-hidden");
        results.classList.remove("rv-hidden");
        showData(data);
      } else {
        zeroResults.style.display = "";
        document.body.classList.add("rv-loaded");
      }
    });
    
    vscode.postMessage({
      command: "getData",
      data: {}
    });
  });

}

function showData(data: any) {
  const grid = document.querySelector<DataGrid>("#results-grid");
  if (!grid) throw new Error();

  grid.rowsData = data.tableBody;
  setTimeout(() => {
    const columns = Object.keys(data.tableBody[0]).length;
    const styleEl = document.createElement('style');
    let style = '';
    for(let i = 1; i <= columns; i++) {
      const col = grid.querySelectorAll<DataGridCell>(`[grid-column="${i}"]`);
      let max = 0;
      col.forEach((cell) => {
        const width = cell.getBoundingClientRect().width;
        if(width > max) {
          max = width;
        }
      });
      style += `[grid-column="${i}"]{width:${max}px !important}`;
    }
    styleEl.innerHTML = style;
    document.head.appendChild(styleEl);
  }, 16);
}

// function showData(data) {
//   $("#query-results").DataTable({
//     scrollX: true,
//     iDisplayLength: data.recordsPerPage == "All records" ? -1 : parseInt(data.recordsPerPage),
//     columns: data.tableHeader,
//     data: data.tableBody,
//     order: [],
//     dom: "Bfrtip",
//     buttons: [
//       "pageLength",
//       {
//         extend: "collection",
//         text: "Export data",
//         autoClose: true,
//         buttons: [
//           {
//             text: "as JSON",
//             action: function (e, dt, button, config) {
//               var data = dt.buttons.exportData();
//               $.fn.dataTable.fileSave(new Blob([JSON.stringify(data)]), "Export.json");
//             },
//             title: "Data export",
//             titleAttr: "Export data to .json (JavaScript Object Notation) file."
//           },
//           {
//             extend: "csv",
//             text: "as CSV",
//             title: "Data export",
//             titleAttr: "Export data to .csv (Comma-Separated Value) file."
//           },
//           {
//             extend: "excel",
//             text: "as XLSX",
//             title: "Data export",
//             titleAttr: "Export data to .xlsx (Excel Workbook) file."
//           },
//           {
//             extend: "pdf",
//             text: "as PDF",
//             title: "Data export",
//             titleAttr: "Export data to .pdf (Portable Document Format) file."
//           }
//         ]
//       }
//     ],
//     lengthMenu: [[10, 25, 50, 100, -1], ["10 rows", "25 rows", "50 rows", "100 rows", "Show all"]]
//   });
//   $("body").addClass("loaded");
// }
