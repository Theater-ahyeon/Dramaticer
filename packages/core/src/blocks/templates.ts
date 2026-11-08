/** HTML 显示模板里的占位符；显示层把它替换成转义后的块原文。 */
export const BLOCK_TEMPLATE_CONTENT_TOKEN = "{{content}}";

/**
 * 图片块的沙箱模板：只加载经过父页面校验的单个地址，点击后请求放大。
 * 模板在 iframe 里执行，块原文始终按文本转义后替换。
 */
export const IMAGE_BLOCK_TEMPLATE = `<style>
img {
	display: block;
	max-width: 100%;
	height: auto;
	border-radius: 8px;
	cursor: zoom-in;
}
</style>
<img src="${BLOCK_TEMPLATE_CONTENT_TOKEN}" alt="剧情插图">
<script>
(function () {
	var image = document.querySelector("img");
	image.addEventListener("click", function () {
		parent.postMessage({ type: "action", action: { kind: "zoom" } }, "*");
	});
})();
</script>`;
