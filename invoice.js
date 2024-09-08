function ready(fn) {
  if (document.readyState !== 'loading'){
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}

function addDemo(row) {
  if (!row.Issued && !row.Due) {
    for (const key of ['Number', 'Issued', 'Due']) {
      if (!row[key]) { row[key] = key; }
    }
    for (const key of ['Subtotal', 'Deduction', 'Taxes', 'Total']) {
      if (!(key in row)) { row[key] = key; }
    }
    if (!('Note' in row)) { row.Note = '(Anything in a Note column goes here)'; }
  }
  if (!row.Invoicer) {
    row.Invoicer = {
      Name: 'Invoicer.Name',
      Street1: 'Invoicer.Street1',
      Street2: 'Invoicer.Street2',
      City: 'Invoicer.City',
      State: '.State',
      Zip: '.Zip',
      Email: 'Invoicer.Email',
      Phone: 'Invoicer.Phone',
      Website: 'Invoicer.Website'
    }
  }

  if (!row.Items) {
    row.Items = [
      {
        Description: 'Items[0].Description',
        Quantity: '.Quantity',
        Total: '.Total',
        Price: '.Price',
      },
      {
        Description: 'Items[1].Description',
        Quantity: '.Quantity',
        Total: '.Total',
        Price: '.Price',
      },
    ];
  }
  return row;
}

const data = {
  count: 0,
  invoice: '',
  status: 'waiting',
  tableConnected: false,
  rowConnected: false,
  haveRows: false,
  imageLoadStatus: {},
  tokenInfo: {},
};
let app = undefined;

Vue.filter('currency', formatNumberAsUSD)
function formatNumberAsUSD(value) {
  if (typeof value !== "number") {
    return value || '—';      // falsy value would be shown as a dash.
  }
  value = Math.round(value * 100) / 100;    // Round to nearest cent.
  value = (value === -0 ? 0 : value);       // Avoid negative zero.

  const result = value.toLocaleString('en', {
    style: 'currency', currency: 'USD'
  })
  if (result.includes('NaN')) {
    return value;
  }
  return result;
}

Vue.filter('round', function (value) {
  return value.toFixed(2);
});

Vue.filter('fallback', function(value, str) {
  if (!value) {
    throw new Error("Please provide column " + str);
  }
  return value;
});

Vue.filter('asDate', function(value) {
  if (typeof(value) === 'number') {
    value = new Date(value * 1000);
  }
  const date = moment.utc(value)
  return date.isValid() ? date.format('MMMM DD, YYYY') : value;
});
Vue.filter('asDateM', function(value) {
  if (typeof(value) === 'number') {
    value = new Date(value * 1000);
  }
  const date = moment.utc(value);
  return date.isValid() ? date.format('MM/DD/YY') : value;
});
function tweakUrl(url) {
  if (!url) { return url; }
  if (url.toLowerCase().startsWith('http')) {
    return url;
  }
  return 'https://' + url;
};

function handleError(err) {
  console.error(err);
  const target = app || data;
  target.invoice = '';
  target.status = String(err).replace(/^Error: /, '');
  console.log(data);
}

function prepareList(lst, order) {
  if (order) {
    let orderedLst = [];
    const remaining = new Set(lst);
    for (const key of order) {
      if (remaining.has(key)) {
        remaining.delete(key);
        orderedLst.push(key);
      }
    }
    lst = [...orderedLst].concat([...remaining].sort());
  } else {
    lst = [...lst].sort();
  }
  return lst;
}

async function updateInvoice(row) {
  try {
    data.status = '';
    if (row === null) {
      throw new Error("(No data - not on row - please add or select a row)");
    }
    console.log("GOT...", JSON.stringify(row));
    if (row.References) {
      try {
        Object.assign(row, row.References);
      } catch (err) {
        throw new Error('Could not understand References column. ' + err);
      }
    }

    // Add some guidance about columns.
    const want = new Set(['Img', 'PCS', 'KARAT', 'Description', 'Options', 'Type','Weight (GR)', 'Labor/GR', 'Labor', 'Gold', 'Total']);
    const accepted = new Set(['References']);
    const importance = ['Img', 'PCS', 'KARAT', 'Description', 'Options', 'Type','Weight (GR)', 'Labor/GR', 'Labor', 'Gold', 'Total'];

    if (!(row.Due || row.Issued)) {
      const seen = new Set(Object.keys(row).filter(k => k !== 'id' && k !== '_error_'));
      const help = row.Help = {};
      help.seen = prepareList(seen);
      const missing = [...want].filter(k => !seen.has(k));
      const ignoring = [...seen].filter(k => !want.has(k) && !accepted.has(k));
      const recognized = [...seen].filter(k => want.has(k) || accepted.has(k));
      if (missing.length > 0) {
        help.expected = prepareList(missing, importance);
      }
      if (ignoring.length > 0) {
        help.ignored = prepareList(ignoring);
      }
      if (recognized.length > 0) {
        help.recognized = prepareList(recognized);
      }
      if (!seen.has('References') && !(row.Issued || row.Due)) {
        row.SuggestReferencesColumn = true;
      }
    }
    addDemo(row);
    if (!row.Subtotal && !row.Total && row.Items && Array.isArray(row.Items)) {
      try {
        row.Subtotal = row.Items.reduce((a, b) => a + b.Price * b.Quantity, 0);
        row.Total = row.Subtotal + (row.Taxes || 0) - (row.Deduction || 0);
      } catch (e) {
        console.error(e);
      }
    }
    if (row.Invoicer && row.Invoicer.Website && !row.Invoicer.Url) {
      row.Invoicer.Url = tweakUrl(row.Invoicer.Website);
    }

    if (row.Items && Array.isArray(row.Items)) {
      data.tokenInfo = await grist.docApi.getAccessToken({ readOnly: true });
      data.imageLoadStatus = {};

      row.Items.forEach((item, index) => {
        if (item.Img) {
          const id = item.Img;
          const src = `${data.tokenInfo.baseUrl}/attachments/${id}/download?auth=${data.tokenInfo.token}`;
          const img = document.querySelector(`.img-${index}`);

          if (img) {
            img.setAttribute('src', src);
            item.ImgUrl = src;
            // Track image load status
            data.imageLoadStatus[index] = false;

            img.onload = () => {
              data.imageLoadStatus[index] = true;
              console.log(`Image ${index} loaded successfully.`);
            };

            img.onerror = () => {
              data.imageLoadStatus[index] = false;
            };
          }
        }
      });

      // Check image load status and retry if necessary
      setTimeout(() => {
        retryLoadingImages(row.Items, data.imageLoadStatus, data.tokenInfo);
      }, 2000); // Retry after 3 seconds
    }
    // Fiddle around with updating Vue (I'm not an expert).
    for (const key of want) {
      Vue.delete(data.invoice, key);
    }
    for (const key of ['Help', 'SuggestReferencesColumn', 'References']) {
      Vue.delete(data.invoice, key);
    }
    data.invoice = Object.assign({}, data.invoice, row);

    // Make invoice information available for debugging.
    window.invoice = row;
  } catch (err) {
    handleError(err);
  }
}

function retryLoadingImages(items, imageLoadStatus, tokenInfo) {
  items.forEach((item, index) => {
    if (!imageLoadStatus[index] && item.Img) {
      const id = item.Img;
      const src = `${tokenInfo.baseUrl}/attachments/${id}/download?auth=${tokenInfo.token}`;
      const img = document.querySelector(`.img-${index}`);

      if (img) {
        img.setAttribute('src', src);

        img.onload = () => {
          imageLoadStatus[index] = true;
          console.log(`Image ${index} loaded successfully on retry.`);
        };

        img.onerror = () => {
          imageLoadStatus[index] = false;
        };
      }
    }
  });
} 


function getImageUrl(description) {
  const baseUrl = 'https://raw.githubusercontent.com/MCWholesale/MCWholesale.github.io/main/MCWHOLESALE_PHOTOS/';
  
  // Append "Monaco Chain" to the description
  let descriptionWithBrand = `Monaco Chain ${description}`;
  
  // Encode the updated description for URL usage
  let encodedDescription = encodeURIComponent(descriptionWithBrand);

  // Replace any problematic encoding if needed
  encodedDescription = encodedDescription.replace(/%C3%A9/g, 'e%CC%81');

  return `${baseUrl}${encodedDescription}.png`;
}

async function embedImagesAsBase64(invoice) {
  for (let i = 0; i < invoice.Items.length; i++) {
    const imgUrl = getImageUrl(invoice.Items[i].Description);
    try {
      const base64Image = await convertImageToBase64(imgUrl);
      if (base64Image) {
        invoice.Items[i].ImgBase64 = base64Image;
      } else {
        console.log(`Image not found for item at index ${i}: ${imgUrl}`);
      }
    } catch (error) {
      console.log(`Error fetching image for item at index ${i}: ${error.message}`);
    }
  }
}

async function convertImageToBase64(imgUrl) {
  const response = await fetch(imgUrl, { mode: 'cors' });
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function updateHTMLWithBase64Images(invoice) {
  invoice.Items.forEach((item, index) => {
    const imgElement = document.querySelector(`.img-${index}`);
    if (imgElement && item.ImgBase64) {
      imgElement.src = item.ImgBase64;
    }
  });
}



async function generatePDF() {
  // Hide unnecessary elements before PDF generation
  document.querySelectorAll('.print').forEach(el => {
    el.style.display = 'none';
  });

  // Convert images to Base64 and embed them
  await embedImagesAsBase64(data.invoice);
  updateHTMLWithBase64Images(data.invoice);

  // Get the position of the last element
  const lastElement = document.getElementById('last_element');
  let windowHeight = document.body.scrollHeight;

  if (lastElement) {
    const rect = lastElement.getBoundingClientRect();
    windowHeight = rect.bottom + window.scrollY; // Adjust to the last element's position
  }

  // Force everything to one page by removing page breaks
  const opt = {
    margin: [0, 2, 0, 2],
    filename: 'Current Stock.pdf',
    image: { type: 'jpeg', quality: 0.75 },
    html2canvas: { 
      scale: 2, 
      useCORS: true, 
      logging: true, 
      windowWidth: document.body.scrollWidth,  // Full width
      windowHeight: windowHeight,  // Up to the last element
      scrollX: document.body.scrollWidth,
      scrollY: -window.scrollY, // Ensure content stays in place during rendering
    },
    jsPDF: { unit: 'px', format: [document.body.scrollWidth, windowHeight], orientation: 'portrait' }
  };

  const pdfBlob = await html2pdf().from(document.body).set(opt).outputPdf('blob');

  // Convert PDF Blob to base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(pdfBlob);
    reader.onloadend = () => resolve(reader.result.split(',')[1]);  // Return base64 data
    reader.onerror = reject;
  });
}


async function sendEmails() {
  try {
    const progressBar = document.getElementById('progress-bar');
    const totalEmails = data.invoice.Emails.length;
    let sentEmails = 0;

    progressBar.setAttribute('data-label', `Email sending 0/${totalEmails}`);
    progressBar.value = 0;

    // Step 1: Generate the PDF
    const originalPDFBlob = await generatePDF();

    // Step 2: Load the PDF using pdf-lib to manipulate it
    const pdfBytes = await originalPDFBlob.arrayBuffer(); // Convert Blob to ArrayBuffer
    const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes); // Use PDFLib (from the CDN)

    // Step 3: Remove the first page
    const totalPages = pdfDoc.getPageCount();
    if (totalPages > 1) {
      pdfDoc.removePage(0); // Remove the first page
    }

    // Step 4: Save the modified PDF
    const modifiedPdfBytes = await pdfDoc.save();
    const base64PDF = btoa(String.fromCharCode(...new Uint8Array(modifiedPdfBytes))); // Convert to base64

    const smpt2goApiUrl = 'https://api.smtp2go.com/v3/email/send';
    const apiKey = data.invoice.key;
    const subject = 'Updated Inventory';
    const body = `
      <p>Please see the attached PDF of our current inventory. Orders from this inventory can be delivered as soon as the next day.</p>
      <p>Feel free to reach out if you have any questions or need further assistance.</p>
      <p>Best regards,</p>
      <br>
      <img src="https://github.com/MCWholesale/MCWholesale.github.io/blob/main/email_body_end.png?raw=true" alt="Company Info" style="width: 100%; height: auto;" />
    `;

    const emailPromises = data.invoice.Emails.map(async (email) => {
      const emailData = {
        api_key: apiKey,
        to: [email],
        sender: 'mustafa@oromonaco.com',
        subject: subject,
        html_body: body,
        attachments: [
          {
            filename: "Current Stock.pdf",
            fileblob: base64PDF,
            mimetype: "application/pdf"
          }
        ]
      };

      try {
        const response = await axios.post(smpt2goApiUrl, emailData, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`Email sent to ${email}:`, response.data);
        sentEmails++;
        progressBar.value = (sentEmails / totalEmails) * 100;
        progressBar.setAttribute('data-label', `Email sending ${sentEmails}/${totalEmails}`);
      } catch (error) {
        console.error(`Error sending email to ${email}:`, error.response ? error.response.data : error.message);
      }
    });

    await Promise.all(emailPromises);

    progressBar.setAttribute('data-label', "COMPLETED");
  } catch (error) {
    console.error("Error generating PDF or sending emails:", error);
  }
}



ready(function() {
  // Update the invoice anytime the document data changes.
  grist.ready();
  grist.onRecord(updateInvoice);

  // Monitor status so we can give user advice.
  grist.on('message', msg => {
    // If we are told about a table but not which row to access, check the
    // number of rows.  Currently if the table is empty, and "select by" is
    // not set, onRecord() will never be called.
    if (msg.tableId && !app.rowConnected) {
      grist.docApi.fetchSelectedTable().then(table => {
        if (table.id && table.id.length >= 1) {
          app.haveRows = true;
        }
      }).catch(e => console.log(e));
    }
    if (msg.tableId) { app.tableConnected = true; }
    if (msg.tableId && !msg.dataChange) { app.RowConnected = true; }
  });

  Vue.config.errorHandler = function (err, vm, info)  {
    handleError(err);
  };

  app = new Vue({
    el: '#app',
    data: data,
    computed: {
      groupedItems() {
        const groups = {};
        const desiredOrder = ['10K', '14K', '18K', '21K', '22K'];
        if (Array.isArray(this.invoice.Items)) {
          this.invoice.Items.forEach(item => {
            const karat = item.Metal + 'K';
            if (!groups[karat]) {
              groups[karat] = {
                totalWeight: 0,
                totalGoldPrice: 0,
                totalLabor: 0,
                goldPerGram: 0,
                totalPrice: 0,
                totalQty: 0,
                NecklaceQty : 0,
                BraceletQty : 0,
                AnkletQty: 0,
                RingQty: 0,
                EarringQty: 0,
                NecklaceWeight : 0,
                BraceletWeight : 0,
                AnkletWeight: 0,
                RingWeight: 0,
                EarringWeight: 0,
              };
            }
            groups[karat].totalWeight += item.Balance_Weight;
            groups[karat].totalGoldPrice += item.Spot_Gold;
            groups[karat].totalLabor += item.Sold_Labor_Total;
            groups[karat].totalPrice += item.Spot_Gold + item.Sold_Labor_Total;
            groups[karat].goldPerGram = groups[karat].totalGoldPrice / groups[karat].totalWeight;
            groups[karat].totalQty += item.Balance_Qty;

            switch (item.Type) {
              case 'Necklace':
                groups[karat].NecklaceQty += item.Balance_Qty;
                groups[karat].NecklaceWeight += item.Balance_Weight;
                break;
              case 'Bracelet':
                groups[karat].BraceletQty += item.Balance_Qty;
                groups[karat].BraceletWeight += item.Balance_Weight;
                break;
              case 'Anklet':
                groups[karat].AnkletQty += item.Balance_Qty;
                groups[karat].AnkletWeight += item.Balance_Weight;
                break;
              case 'Ring':
                groups[karat].RingQty += item.Balance_Qty;
                groups[karat].RingWeight += item.Balance_Weight;
                break;
              case 'Earring':
                groups[karat].EarringQty += item.Balance_Qty;
                groups[karat].EarringWeight += item.Balance_Weight;
                break;
              default:
                break;
            }
          });
        }
        // Ensure the groups are returned in the desired order
        const orderedGroups = {};
        desiredOrder.forEach(karat => {
          if (groups[karat]) {
            orderedGroups[karat] = groups[karat];
          }
        });
        return orderedGroups;
      },
      borderColors() {
          return ['gray', '#ed5f68', 'blue', 'green', 'orange'];
        },
      grandTotalQty() {
        return this.invoice.Items.reduce((total, item) => total + item.Balance_Qty, 0);
      },
      grandTotalWeight() {
        return this.invoice.Items.reduce((total, item) => total + item.Balance_Weight, 0);
      },
      grandTotalGoldPrice() {
        return this.invoice.Items.reduce((total, item) => total + item.Spot_Gold, 0);
      },
      grandTotalLabor() {
        return this.invoice.Items.reduce((total, item) => total + item.Sold_Labor_Total, 0);
      },
      grandTotalPrice() {
        return this.invoice.Items.reduce((total, item) => total + item.Spot_Gold_Labor_Duty, 0);
      },
      grandTotalNecklaceQty() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Necklace' ? total + item.Balance_Qty : total, 0);
      },
      grandTotalNecklaceWeight() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Necklace' ? total + item.Balance_Weight : total, 0);
      },
      grandTotalBraceletQty() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Bracelet' ? total + item.Balance_Qty : total, 0);
      },
      grandTotalBraceletWeight() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Bracelet' ? total + item.Balance_Weight : total, 0);
      },
      grandTotalAnkletQty() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Anklet' ? total + item.Balance_Qty : total, 0);
      },
      grandTotalAnkletWeight() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Anklet' ? total + item.Balance_Weight : total, 0);
      },
      grandTotalRingQty() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Ring' ? total + item.Balance_Qty : total, 0);
      },
      grandTotalRingWeight() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Ring' ? total + item.Balance_Weight : total, 0);
      },
      grandTotalEarringQty() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Earring' ? total + item.Balance_Qty : total, 0);
      },
      grandTotalEarringWeight() {
        return this.invoice.Items.reduce((total, item) => item.Type === 'Earring' ? total + item.Balance_Weight : total, 0);
      },
      groupedPayments() {
        if (!Array.isArray(this.invoice.Payments)) {
          return [];
        }
        return this.invoice.Payments.map(payment => ({
          Amount: payment[0],
          Method: payment[1][0],
          Date: payment[2] ? new Date(payment[2]) : null
        }));
      },
      isSingleOverview() {
        return Object.keys(this.groupedItems).length === 1;
      },
      wireAccountList() {
        return this.invoice.Wire_Account ? this.invoice.Wire_Account.split(',') : [];
      },
    },
    methods: {
      optionsList(item) {
        return item.options ? item.options.split(',') : [];
      },
      retryLoadingImagesWithButton() {
        this.invoice.Items.forEach((item, index) => {
          if (!this.imageLoadStatus[index] && item.Img) {
            const id = item.Img;
            const src = `${this.tokenInfo.baseUrl}/attachments/${id}/download?auth=${this.tokenInfo.token}`;
            const img = document.querySelector(`.img-${index}`);

            if (img) {
              img.setAttribute('src', src);

              img.onload = () => {
                this.imageLoadStatus[index] = true;
                console.log(`Image ${index} loaded successfully on retry.`);
              };

              img.onerror = () => {
                this.imageLoadStatus[index] = false;
              };
            }
          }
        });
      },
      getBackgroundColor(metal) {
        const metalValue = Number(metal); // Ensure it's a number
        switch (metalValue) {
          case 10:
            return '#DCDCDC';
          case 14:
            return '#FECBCC';
          case 18:
            return '#FEF47A';
          case 21:
            return '#928619';
          case 22:
            return '#FD9D28';
          default:
            return 'transparent'; // Default color if metal value doesn't match
        }
      }
    }
  });

  if (document.location.search.includes('demo')) {
    updateInvoice(exampleData);
  }
  if (document.location.search.includes('labels')) {
    updateInvoice({});
  }
});