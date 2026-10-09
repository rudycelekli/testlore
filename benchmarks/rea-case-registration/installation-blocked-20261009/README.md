# Retained installation rejection

[Actual run 37947220000](https://github.com/rudycelekli/testlore/actions/runs/37947220000), producer `7532ad0005c81686e7edaa3729b349cd5cb43690`, stopped the original REA installation after approximately 5.75 seconds because volume growth exceeded its preregistered 450 MiB limit. Observed growth was **501,014,528 bytes**; the 2 GiB reserve remained intact. Root TestLore bootstrap had completed separately.

No native REA task registrations were observed. This is a resource-policy rejection, not evidence that registration metadata worked or that test selection is safe. The original API-digest-verified artifact (`9797d393683e28942d2e6c501ab279e043a1b4223577942fb7e8480f80260d86`) and raw receipts are retained unchanged.

The next separate run prospectively permits 768 MiB for the original REA installation, retaining the same 180-second deadline, 2 GiB reserve, complete original dependency installation and protected source checks. The root bootstrap limit stays 450 MiB. This prospective resource change does not alter or reclassify the original failed run.
