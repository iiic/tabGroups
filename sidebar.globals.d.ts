declare namespace Classes {
	interface SidebarController extends BaseController {
		outputEl: HTMLElement;
		initPage(): Promise<void>;
	}
}
