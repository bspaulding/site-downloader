const puppeteer = require('puppeteer');
const args = require('args');
const url = require('url');
const util = require('util');
const fs = require('fs');
const path = require('path');
const mkdirp = util.promisify(require('mkdirp'));
const fetch = require('node-fetch');

const { URL } = url;
const writeFile = util.promisify(fs.writeFile);

console.log('url', url);

args
	.option('url', 'Initial url to start scraping from', '')
	.option('only-host', 'Limit following hrefs on this domain', '')
	.option('out', 'Directory to write files as local root of site', '');

const flags = args.parse(process.argv);

const isRemote = url => url.match(/(^\/\/)|(^https?:\/\/)/);

const writeContentFromUrl = async (url, content) => {
	const localPath = path.join(flags.out, (new URL(url)).pathname);
	await mkdirp(path.dirname(localPath));
	console.log(`Writing file to path: ${localPath}...`);
	await writeFile(localPath, content);
};

const downloadUrl = async href =>
	writeContentFromUrl(href, await (await fetch(href)).text());

(async () => {
	const url = flags.url;
	console.log(`Starting to scrape ${url}...`);
	console.log(`Launching browser...`);
	const browser = await puppeteer.launch();
	try {
		const page = await browser.newPage();
		let urls = [url];
		let visitedUrls = [];
		while (urls.length) {
			const url = urls.pop();
			visitedUrls.push(url);
			console.log(`Navigating to ${url}...`);
			await page.goto(url);

			const content = await page.content();
			await writeContentFromUrl(url, content);

			// console.log(`Saving pdf...`);
			// const title = await page.title();
			// const pathname = new URL(url).pathname.replace(/\//g, '-');
			// await page.pdf({ path: `./scraped-data/${title}-${pathname || 'index.html'}.pdf` });

			const links = await page.$$('link');
			for (let l of links) {
				const rel = await (await l.getProperty('rel')).jsonValue();
				if (rel === 'stylesheet') {
					const href = await (await l.getProperty('href')).jsonValue();
					if (urls.indexOf(href) < 0 && visitedUrls.indexOf(href) < 0) {
						console.log(`Found new stylesheet ${href}`);
						try {
							await downloadUrl(href);
							visitedUrls.push(href);
						} catch (e) {
							console.error(e, `Was downloading ${href}`);
						}
					}
				}
			}

			const imgs = await page.$$('img');
			for (let i of imgs) {
				const src = await (await i.getProperty('src')).jsonValue();
				if (urls.indexOf(src) < 0 && visitedUrls.indexOf(src) < 0) {
					console.log(`Found new image ${src}`);
					await downloadUrl(src);
					visitedUrls.push(src);
				}
			}

			const videos = await page.$$('video>source');
			for (let v of videos) {
				const src = await (await v.getProperty('src')).jsonValue();
				if (urls.indexOf(src) < 0 && visitedUrls.indexOf(src) < 0) {
					console.log(`Found new video ${src}`);
					await downloadUrl(src);
					visitedUrls.push(src);
				}
			}

			const scripts = await page.$$('script[src]');
			for (let s of scripts) {
				const src = await (await s.getProperty('src')).jsonValue();
				if (src.indexOf(flags.onlyHost) >= 0 && urls.indexOf(src) < 0 && visitedUrls.indexOf(src) < 0) {
					console.log(`Found local script ${src}`);
					await downloadUrl(src);
					visitedUrls.push(src);
				}
			}

			console.log(`Getting urls on this page...`);
			const anchors = await page.$$('a');
			if (anchors) {
				let newUrls = [];
				for (let a of anchors) {
					try {
						const hrefHandle = await a.getProperty('href');
						const urlStr = await hrefHandle.jsonValue();
						const parsed = new URL(urlStr);
						const href = parsed.origin + parsed.pathname;
						if ('string' === typeof href
							&& href.length
							&& urls.indexOf(href) < 0
							&& visitedUrls.indexOf(href) < 0
							&& href.slice(0, 6) !== 'mailto'
							&& (!flags.onlyHost || href.indexOf(flags.onlyHost) > 0)
							&& href.indexOf('.pdf') < 0) {
							urls.push(href);
							newUrls.push(href);
						}
					} catch {
					}
				}
				console.log(`Found ${newUrls.length} new urls...`);
			}
		}

		console.log('Closing...');
		await browser.close();
	} catch (e) {
		console.error(e);
		console.log('Closing (exited because of error)...');
		await browser.close();
	}
})();
