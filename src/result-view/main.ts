// file: src/webview/main.ts

import { provideVSCodeDesignSystem, vsCodeButton, vsCodeDataGrid, vsCodeDataGridCell, vsCodeDataGridRow, vsCodeDropdown, vsCodeTextField } from "@vscode/webview-ui-toolkit";

provideVSCodeDesignSystem().register(
    vsCodeButton(),
    vsCodeDropdown(),
    vsCodeTextField(),
    vsCodeDataGrid(),
    vsCodeDataGridCell(),
    vsCodeDataGridRow()
);